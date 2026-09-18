import { addDays, asDate, dateKeyOf, formatFoodTimestamp, todayKey } from './date.ts';
import { batchSheetValues, findById, getRows } from './sheets.ts';
import type { RequestContext } from './context.ts';
import type { ApiResult, SheetRow } from './types.ts';
import { growthAction } from './growthApi.ts';

function text(row: SheetRow, key: string, fallback = ''): string {
  const value = row[key];
  return value === null || value === undefined ? fallback : String(value);
}

function numberValue(value: unknown, fallback: number | null = null): number | null {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function ok<T>(data: T): ApiResult<T> { return { ok: true, data }; }
function fail(code: string, message: string): ApiResult<never> { return { ok: false, error: { code, message } }; }
function notFound(message: string): ApiResult<never> { return fail('NOT_FOUND', message); }

async function userRecord(context: RequestContext, userId: string) {
  const rows = await getRows(context, 'users', (row) => text(row, 'user_id') === userId);
  const row = rows[0];
  return {
    userId,
    name: row ? (text(row, 'User_Name') || text(row, 'user_name') || 'ユーザー') : 'ユーザー',
    weight: numberValue(row?.weight),
    height: numberValue(row?.height),
    targetCalories: numberValue(row?.target_calories),
    isPremium: bool(row?.is_premium),
  };
}

function sortByDateDesc(a: SheetRow, b: SheetRow, field: string): number {
  return asDate(b[field]).getTime() - asDate(a[field]).getTime();
}

async function trainingMaster(context: RequestContext): Promise<SheetRow[]> {
  return getRows(context, 'Training_Master', (row) => bool(row.is_active));
}

async function trainingMenus(context: RequestContext, userId: string): Promise<SheetRow[]> {
  const rows = await getRows(context, 'Training_Menus', (row) => text(row, 'user_id') === userId && bool(row.is_active));
  return rows.sort((a, b) => (numberValue(a.display_order, 0) ?? 0) - (numberValue(b.display_order, 0) ?? 0));
}

async function trainingSetsByLog(context: RequestContext, logIds?: Set<string>): Promise<Map<string, SheetRow[]>> {
  const rows = await getRows(context, 'Training_Sets', logIds ? (row) => logIds.has(text(row, 'training_log_id')) : undefined);
  const byLog = new Map<string, SheetRow[]>();
  rows.forEach((row) => {
    const key = text(row, 'training_log_id');
    const list = byLog.get(key) ?? [];
    list.push(row);
    byLog.set(key, list);
  });
  byLog.forEach((list) => list.sort((a, b) => (numberValue(a.set_no, 0) ?? 0) - (numberValue(b.set_no, 0) ?? 0)));
  return byLog;
}

async function trainingLogs(context: RequestContext, userId: string): Promise<SheetRow[]> {
  const [logs, allSets] = await Promise.all([
    getRows(context, 'Training_Logs', (row) => text(row, 'user_id') === userId),
    getRows(context, 'Training_Sets'),
  ]);
  const ids = new Set(logs.map((row) => text(row, 'training_log_id')));
  const setsByLog = new Map<string, SheetRow[]>();
  allSets.forEach((row) => {
    const key = text(row, 'training_log_id');
    if (!ids.has(key)) return;
    const list = setsByLog.get(key) ?? [];
    list.push(row);
    setsByLog.set(key, list);
  });
  setsByLog.forEach((list) => list.sort((a, b) => (numberValue(a.set_no, 0) ?? 0) - (numberValue(b.set_no, 0) ?? 0)));
  logs.forEach((log) => { log.sets = setsByLog.get(text(log, 'training_log_id')) ?? []; });
  return logs.sort((a, b) => sortByDateDesc(a, b, 'training_date'));
}

async function getTrainingLogs(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const user = await userRecord(context, userId);
  const all = await trainingLogs(context, userId);
  const defaultFrom = dateKeyOf(addDays(new Date(), -6));
  const from = user.isPremium ? String(params.from || defaultFrom) : defaultFrom;
  const to = user.isPremium ? String(params.to || todayKey()) : todayKey();
  return ok({ logs: all.filter((log) => {
    const key = dateKeyOf(log.training_date);
    return key >= from && key <= to;
  }), from, to, range_restricted: !user.isPremium });
}

async function getTrainingLogDetail(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const id = String(params.training_log_id ?? '');
  const log = await findById(context, 'Training_Logs', 'training_log_id', id);
  if (!log || text(log, 'user_id') !== userId) return notFound('ログが見つかりません');
  const user = await userRecord(context, userId);
  if (!user.isPremium && dateKeyOf(log.training_date) < dateKeyOf(addDays(new Date(), -6))) return notFound('ログが見つかりません');

  const sets = (await trainingSetsByLog(context, new Set([id]))).get(id) ?? [];
  const allSets = await getRows(context, 'Training_Sets');
  const countBy = new Map<string, number>();
  allSets.forEach((set) => countBy.set(text(set, 'training_log_id'), (countBy.get(text(set, 'training_log_id')) ?? 0) + 1));
  const masterId = text(log, 'master_id');
  const name = text(log, 'exercise_name_snapshot');
  const from = dateKeyOf(addDays(new Date(), user.isPremium ? -89 : -6));
  const history = (await getRows(context, 'Training_Logs', (row) => {
    if (text(row, 'user_id') !== userId || text(row, 'training_log_id') === id) return false;
    const matches = masterId ? text(row, 'master_id') === masterId : text(row, 'exercise_name_snapshot') === name;
    const key = dateKeyOf(row.training_date);
    return matches && key >= from && key <= todayKey();
  })).sort((a, b) => sortByDateDesc(a, b, 'training_date')).slice(0, 20).map((row) => ({
    training_log_id: row.training_log_id,
    training_date: row.training_date,
    estimated_calories: row.estimated_calories,
    duration_min: row.duration_min,
    sets_count: countBy.get(text(row, 'training_log_id')) ?? 0,
  }));
  return ok({ log, sets, history, history_restricted: !user.isPremium });
}

async function getDailyCalorieSummary(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const date = params.date ? dateKeyOf(params.date) : todayKey();
  const [meals, exercises, user] = await Promise.all([
    getRows(context, 'logs', (row) => text(row, 'user_id') === userId && dateKeyOf(row.timestamp) === date),
    getRows(context, 'Training_Logs', (row) => text(row, 'user_id') === userId && dateKeyOf(row.training_date) === date),
    userRecord(context, userId),
  ]);
  const target = user.targetCalories || 2000;
  const intake = meals.reduce((sum, row) => sum + (numberValue(row.calories, 0) ?? 0), 0);
  const exercise = exercises.reduce((sum, row) => sum + (numberValue(row.estimated_calories, 0) ?? 0), 0);
  return ok({ date, target_calories: target, intake_calories: intake, remaining_calories: target - intake, estimated_exercise_calories: exercise, exercise_note: 'セット内容等から推定した参考値です' });
}

function weekStart(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return dateKeyOf(date);
}

function buildGlance(logs: SheetRow[], setsByLog: Map<string, SheetRow[]>, meals: SheetRow[]) {
  const blocks: Record<string, unknown> = {};
  const today = todayKey();
  const todayLogs = logs.filter((log) => dateKeyOf(log.training_date) === today).sort((a, b) => text(b, 'created_at').localeCompare(text(a, 'created_at')));
  if (todayLogs.length) {
    const log = todayLogs[0];
    const sets = setsByLog.get(text(log, 'training_log_id')) ?? [];
    let sentence = `${text(log, 'exercise_name_snapshot')}を記録`;
    if (sets.length) {
      const set = sets[0];
      const weight = numberValue(set.weight_kg);
      sentence = `${text(log, 'exercise_name_snapshot')} ${bool(set.is_bodyweight) ? '自重' : (weight === null ? '' : `${weight}kg`)}×${numberValue(set.reps, 0) ?? 0}を記録`;
    } else if ((numberValue(log.duration_min, 0) ?? 0) > 0) {
      sentence = `${text(log, 'exercise_name_snapshot')} ${numberValue(log.duration_min, 0)}分を記録`;
    }
    blocks.D1 = { status: 'ready', data: { text: sentence } };
  } else {
    const todayMeals = meals.filter((meal) => dateKeyOf(meal.timestamp) === today);
    blocks.D1 = todayMeals.length ? { status: 'ready', data: { text: `${text(todayMeals[todayMeals.length - 1], 'menu_name') || '食事'}を記録` } } : { status: 'empty', message: 'まだデータが足りません' };
  }

  const currentWeek = weekStart(today);
  const days = new Set(logs.filter((log) => weekStart(dateKeyOf(log.training_date)) === currentWeek).map((log) => dateKeyOf(log.training_date)));
  blocks.D2 = { status: 'ready', data: { days: days.size, reference_goal: 3 } };

  const allDays = [...new Set(logs.map((log) => dateKeyOf(log.training_date)))].sort();
  if (allDays.length < 6 || allDays[allDays.length - 1] === today) {
    blocks.R2 = { status: 'empty', message: 'まだデータが足りません' };
  } else {
    let sum = 0;
    for (let index = allDays.length - 5; index < allDays.length; index += 1) {
      sum += (new Date(`${allDays[index]}T00:00:00+09:00`).getTime() - new Date(`${allDays[index - 1]}T00:00:00+09:00`).getTime()) / 86400000;
    }
    const average = sum / 5;
    const current = (new Date(`${today}T00:00:00+09:00`).getTime() - new Date(`${allDays[allDays.length - 1]}T00:00:00+09:00`).getTime()) / 86400000;
    blocks.R2 = current > average * 1.5 ? { status: 'ready', data: { average_interval: Math.round(average * 10) / 10, current_interval: current } } : { status: 'empty', message: 'まだデータが足りません' };
  }
  return blocks;
}

async function getDashboardAll(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const [user, logs, meals] = await Promise.all([
    userRecord(context, userId),
    getRows(context, 'Training_Logs', (row) => text(row, 'user_id') === userId),
    getRows(context, 'logs', (row) => text(row, 'user_id') === userId),
  ]);
  const ids = new Set(logs.map((row) => text(row, 'training_log_id')));
  const [setsByLog, summaryResult, goalResult] = await Promise.all([
    trainingSetsByLog(context, ids),
    getDailyCalorieSummary(context, userId, params),
    getGoalPlans(context, userId),
  ]);
  if (!summaryResult.ok) return summaryResult;
  const goalBanner = goalResult.ok ? buildGoalBanner(goalResult.data) : { show: false, message: '' };
  const glance = buildGlance(logs, setsByLog, meals);
  return ok({ summary: summaryResult.data, dashboard: { user: { name: user.name, isPremium: user.isPremium }, glance }, glance, goal_banner: goalBanner });
}

function buildGoalBanner(data: unknown): { show: boolean; message: string } {
  const active = (data as { active_plan?: SheetRow | null } | null)?.active_plan;
  const end = text(active ?? {}, 'planned_end_date').slice(0, 10);
  const show = !!end && todayKey() > end;
  return { show, message: show ? '目標期間が終了しています。現在の体重・体組成を確認し、必要に応じて目標を更新してください。' : '' };
}

type MealDay = {
  date: string;
  meals_count: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  calcium: number;
  iron: number;
  potassium: number;
  magnesium: number;
  zinc: number;
  vit_a: number;
  vit_c: number;
  vit_d: number;
  vit_e: number;
  vit_b1: number;
  vit_b2: number;
  vit_b6: number;
  vit_b12: number;
  folate: number;
};

function nutritionBounds(range: string): { from: string | null; to: string } {
  const days: Record<string, number> = { '7d': 6, '30d': 29, '90d': 89, '1y': 364 };
  return { from: days[range] === undefined ? null : dateKeyOf(addDays(new Date(), -days[range])), to: todayKey() };
}

async function mealDays(context: RequestContext, userId: string, bounds: { from: string | null; to: string }): Promise<MealDay[]> {
  const days = new Map<string, MealDay>();
  const rows = await getRows(context, 'logs', (row) => text(row, 'user_id') === userId);
  rows.forEach((row) => {
    const key = dateKeyOf(row.timestamp);
    if (!inBounds(key, bounds)) return;
    const day = days.get(key) ?? {
      date: key, meals_count: 0, calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, calcium: 0,
      iron: 0, potassium: 0, magnesium: 0, zinc: 0, vit_a: 0, vit_c: 0, vit_d: 0, vit_e: 0,
      vit_b1: 0, vit_b2: 0, vit_b6: 0, vit_b12: 0, folate: 0,
    };
    day.meals_count += 1;
    (['calories', 'protein', 'fat', 'carbs', 'fiber', 'calcium', 'iron', 'potassium', 'magnesium', 'zinc', 'vit_a', 'vit_c', 'vit_d', 'vit_e', 'vit_b1', 'vit_b2', 'vit_b6', 'vit_b12', 'folate'] as const).forEach((field) => {
      day[field] += numberValue(row[field], 0) ?? 0;
    });
    days.set(key, day);
  });
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function inBounds(key: string, bounds: { from: string | null; to: string }): boolean {
  return !!key && (!bounds.from || key >= bounds.from) && key <= bounds.to;
}

async function nutritionProfile(context: RequestContext, userId: string): Promise<{ gender: string; age: number | null; isPremium: boolean } | null> {
  const row = await findById(context, 'users', 'user_id', userId);
  return row ? { gender: text(row, 'gender'), age: numberValue(row.age), isPremium: bool(row.is_premium) } : null;
}

function pfcRange(age: number | null) {
  return { protein_pct: age !== null && age >= 50 && age <= 64 ? [14, 20] : [13, 20], fat_pct: [20, 30], carbs_pct: [50, 65] };
}

async function nutritionReferences(context: RequestContext, gender: string, age: number | null): Promise<Record<string, { value: number; type: string; unit: string; name: string }>> {
  const band = age !== null && age >= 18 && age <= 29 ? [18, 29] : age !== null && age >= 50 && age <= 64 ? [50, 64] : [30, 49];
  const rows = await getRows(context, 'Nutrition_Reference', (row) => bool(row.is_active) && text(row, 'gender') === gender && numberValue(row.age_min) === band[0] && numberValue(row.age_max) === band[1]);
  const result: Record<string, { value: number; type: string; unit: string; name: string }> = {};
  rows.forEach((row) => {
    const parts = text(row, 'nutrient_id').split('_');
    const key = parts.slice(0, Math.max(parts.length - 3, 1)).join('_');
    result[key] = { value: numberValue(row.reference_value, 0) ?? 0, type: text(row, 'reference_type'), unit: text(row, 'unit'), name: text(row, 'nutrient_name') };
  });
  return result;
}

async function getNutritionAnalysis(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const user = await userRecord(context, userId);
  const range = String(params.range || '7d');
  if (!['7d', '30d', '90d', '1y', 'all'].includes(range)) return fail('VALIDATION_ERROR', 'rangeが不正です');
  const effective = user.isPremium ? range : '7d';
  const bounds = nutritionBounds(effective);
  const days = await mealDays(context, userId, bounds);
  const recorded = days.length;
  const profile = await nutritionProfile(context, userId);
  const genderOk = !!profile && (profile.gender === '男性' || profile.gender === '女性');
  let n1: Record<string, unknown>;
  if (!recorded) n1 = { status: 'empty' };
  else if (recorded < 3) n1 = { status: 'insufficient' };
  else {
    const sums = days.reduce((sum, day) => ({ cal: sum.cal + day.calories, p: sum.p + day.protein, f: sum.f + day.fat, c: sum.c + day.carbs }), { cal: 0, p: 0, f: 0, c: 0 });
    const avgP = sums.p / recorded; const avgF = sums.f / recorded; const avgC = sums.c / recorded;
    const pk = avgP * 4; const fk = avgF * 9; const ck = avgC * 4; const total = pk + fk + ck;
    n1 = {
      status: 'ok', avg_calories: Math.round(sums.cal / recorded), avg_protein_g: Math.round(avgP * 10) / 10,
      avg_fat_g: Math.round(avgF * 10) / 10, avg_carbs_g: Math.round(avgC * 10) / 10,
      ratio_protein_pct: total > 0 ? Math.round(pk / total * 1000) / 10 : null,
      ratio_fat_pct: total > 0 ? Math.round(fk / total * 1000) / 10 : null,
      ratio_carbs_pct: total > 0 ? Math.round(ck / total * 1000) / 10 : null,
      reference_range: pfcRange(profile?.age ?? null),
    };
  }

  let n2: Record<string, unknown>;
  if (!recorded) n2 = { status: 'empty', nutrients: [] };
  else if (recorded < 3 || !genderOk) n2 = { status: 'insufficient', nutrients: [] };
  else {
    const refs = await nutritionReferences(context, profile!.gender, profile!.age);
    const keys = ['fiber', 'calcium', 'iron', 'potassium', 'magnesium', 'zinc', 'vit_a', 'vit_c', 'vit_d', 'vit_e', 'vit_b1', 'vit_b2', 'vit_b6', 'vit_b12', 'folate'];
    const nutrients = keys.map((key) => {
      const ref = refs[key];
      const avgRaw = days.reduce((sum, day) => sum + Number(day[key as keyof MealDay] ?? 0), 0) / recorded;
      const avg = key === 'vit_a' ? avgRaw / 3.33 : avgRaw;
      const raw = ref && ref.value > 0 ? avg / ref.value * 100 : 0;
      return {
        key, name: ref?.name ?? key, avg_intake: Math.round(avg * 10) / 10, unit: ref?.unit ?? '', reference_value: ref?.value ?? null,
        reference_type: ref?.type ?? '', achievement_pct_raw: Math.round(raw * 10) / 10, achievement_pct_display: Math.round(Math.min(raw, 200) * 10) / 10,
      };
    }).sort((a, b) => a.achievement_pct_raw - b.achievement_pct_raw);
    n2 = { status: 'ok', nutrients };
  }
  const n3 = n2.status === 'ok' ? (n2.nutrients as Array<{ key: string; name: string; achievement_pct_raw: number }>).slice(0, 3).filter((nutrient) => nutrient.achievement_pct_raw < 100).map((nutrient) => ({ nutrient_key: nutrient.key, nutrient_name: nutrient.name, message: `記録上、${nutrient.name}の摂取量が少なめです` })) : [];
  const n4 = !recorded ? { status: 'empty' } : recorded < 3 ? { status: 'insufficient' } : { status: 'ok', avg_meals_per_day: Math.round(days.reduce((sum, day) => sum + day.meals_count, 0) / recorded * 10) / 10 };
  const menuAgg = new Map<string, { count: number; cal: number; protein: number }>();
  if (recorded) {
    const rows = await getRows(context, 'logs', (row) => text(row, 'user_id') === userId);
    rows.forEach((row) => {
      if (!inBounds(dateKeyOf(row.timestamp), bounds)) return;
      const name = text(row, 'menu_name').trim();
      if (!name) return;
      const current = menuAgg.get(name) ?? { count: 0, cal: 0, protein: 0 };
      current.count += 1; current.cal += numberValue(row.calories, 0) ?? 0; current.protein += numberValue(row.protein, 0) ?? 0;
      menuAgg.set(name, current);
    });
  }
  const n5 = [...menuAgg.entries()].map(([menu_name, value]) => ({ menu_name, count: value.count, avg_calories: Math.round(value.cal / value.count), avg_protein_g: Math.round(value.protein / value.count * 10) / 10 })).sort((a, b) => b.count - a.count).slice(0, 5);
  return ok({
    range: effective, recorded_days: recorded, status: recorded === 0 ? 'empty' : recorded < 3 ? 'insufficient' : 'ok', n1_pfc: n1,
    n2_micronutrients: n2, n3_hints: n3, n4_meal_frequency: n4, n5_top_menus: n5,
    plan_limits: { range_days: user.isPremium ? null : 7 },
    notes: {
      reference: '栄養基準値は成人向けの一般的な目安であり、医学的な診断・保証を行うものではありません。年齢や体質による個人差があります。',
      no_record: '記録がない日は、食べていないことを意味しません。', pfc: 'PFC比は食事記録から算出した参考値です。', recorded_days: '平均値は記録がある日数を基準に算出しています。',
      protein_bcaa_note: 'BCAA（ロイシン・イソロイシン・バリン）はタンパク質に含まれるアミノ酸です。若年成人では1回あたりのロイシン量と筋タンパク合成の相関は明確でなく、総タンパク質量（目安 約2g/kg/日）が土台です。高齢になるほどアミノ酸への筋の反応が鈍くなるため、1回あたりの量の重要性が上がります。サプリメントは総エネルギーとマクロ栄養素が整った後の補完的位置づけです。本表示は参考情報であり、医学的・効果の保証ではありません。',
    },
  });
}

async function getFoodHistory(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const user = await userRecord(context, userId);
  const range = String(params.range || '7d');
  if (!['7d', '30d', '90d', '1y', 'all'].includes(range)) return fail('VALIDATION_ERROR', 'rangeが不正です');
  const effective = user.isPremium ? range : '7d';
  const days = await mealDays(context, userId, nutritionBounds(effective));
  return ok({ range: effective, days: days.map((day) => ({ date: day.date, meals_count: day.meals_count, calories: day.calories, protein: Math.round(day.protein * 10) / 10 })) });
}

async function getFoodDay(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const date = String(params.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('VALIDATION_ERROR', 'date形式が不正です');
  const user = await userRecord(context, userId);
  const bounds = nutritionBounds('7d');
  if (!user.isPremium && !inBounds(date, bounds)) return notFound('無料プランの期間外です');
  const rows = (await getRows(context, 'logs', (row) => text(row, 'user_id') === userId && dateKeyOf(row.timestamp) === date)).sort((a, b) => asDate(a.timestamp).getTime() - asDate(b.timestamp).getTime() || text(a, 'log_id').localeCompare(text(b, 'log_id')));
  return ok({ date, status: rows.length ? 'ok' : 'empty', meals: rows.map((row) => ({
    timestamp: formatFoodTimestamp(row.timestamp), menu_name: text(row, 'menu_name'), calories: numberValue(row.calories, 0) ?? 0,
    protein: Math.round((numberValue(row.protein, 0) ?? 0) * 10) / 10, fat: Math.round((numberValue(row.fat, 0) ?? 0) * 10) / 10,
    carbs: Math.round((numberValue(row.carbs, 0) ?? 0) * 10) / 10, advice: text(row, 'advice'),
  })) });
}

async function getGoalPlans(context: RequestContext, userId: string): Promise<ApiResult<unknown>> {
  const rows = await getRows(context, 'Goal_Plans', (row) => text(row, 'user_id') === userId);
  let active: SheetRow | null = null;
  const history: SheetRow[] = [];
  rows.forEach((row) => {
    if (text(row, 'status').toLowerCase() === 'active') {
      if (!active || text(row, 'start_date') > text(active, 'start_date')) {
        if (active) history.push(active);
        active = row;
      } else history.push(row);
    } else history.push(row);
  });
  history.sort((a, b) => text(b, 'start_date').localeCompare(text(a, 'start_date')));
  return ok({ active_plan: active, history, notes: { disclaimer: '目標達成度および表示は現在設定されている目標プランに基づく参考値です。' } });
}

async function getTrainingBoard(context: RequestContext, userId: string): Promise<ApiResult<unknown>> {
  const [user, menus, allLogs] = await Promise.all([
    userRecord(context, userId),
    trainingMenus(context, userId),
    getRows(context, 'Training_Logs'),
  ]);
  const from = dateKeyOf(addDays(new Date(), user.isPremium ? -89 : -6));
  const logs = allLogs.filter((row) => text(row, 'user_id') === userId && dateKeyOf(row.training_date) >= from);
  const setsByLog = await trainingSetsByLog(context);
  const logsByMenu = new Map<string, SheetRow[]>();
  logs.forEach((log) => {
    const key = text(log, 'menu_id');
    if (!key) return;
    const list = logsByMenu.get(key) ?? [];
    list.push(log);
    logsByMenu.set(key, list);
  });
  const groups = new Map<string, unknown[]>();
  menus.forEach((menu) => {
    const group = text(menu, 'training_group', 'その他') || 'その他';
    if (group === 'その他') return;
    const byDate = new Map<string, SheetRow[]>();
    (logsByMenu.get(text(menu, 'menu_id')) ?? []).sort((a, b) => sortByDateDesc(a, b, 'training_date')).forEach((log) => {
      const key = dateKeyOf(log.training_date);
      const list = byDate.get(key) ?? [];
      list.push(log);
      byDate.set(key, list);
    });
    const dates = [...byDate.keys()].sort().reverse().slice(0, 2);
    const sessions = dates.map((date) => ({ date, entries: (byDate.get(date) ?? []).map((log) => ({
      training_log_id: log.training_log_id,
      time: text(log, 'created_at').includes('T') ? text(log, 'created_at').slice(text(log, 'created_at').indexOf('T') + 1, text(log, 'created_at').indexOf('T') + 6) : '',
      duration_min: log.duration_min,
      distance_km: log.distance_km,
      rpe: log.rpe,
      memo: log.memo,
      sets: (setsByLog.get(text(log, 'training_log_id')) ?? []).map((set) => ({ weight_kg: set.weight_kg, reps: set.reps, rpe: set.rpe, is_bodyweight: set.is_bodyweight })),
    })) }));
    const item = { menu_id: menu.menu_id, menu_name: menu.menu_name, training_type: menu.training_type, last_date: dates[0] ?? null, sessions };
    groups.set(group, [...(groups.get(group) ?? []), item]);
  });
  return ok({ groups: [...groups.entries()].map(([group, items]) => ({ group, last_date: items.reduce<string | null>((last, item) => {
    const date = (item as { last_date?: string | null }).last_date ?? null;
    return date && (!last || date > last) ? date : last;
  }, null), items })) });
}

async function getBodyComposition(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  const [user, allRows] = await Promise.all([
    userRecord(context, userId),
    getRows(context, 'Body_Composition', (row) => text(row, 'user_id') === userId),
  ]);
  const all = allRows.sort((a, b) => {
    const diff = sortByDateDesc(a, b, 'measured_at');
    return diff || sortByDateDesc(a, b, 'created_at');
  });
  const from = user.isPremium ? (params.from ? String(params.from) : null) : dateKeyOf(addDays(new Date(), -6));
  const to = params.to ? String(params.to) : null;
  const trend = all.filter((row) => {
    const key = dateKeyOf(row.measured_at);
    return (!from || key >= from) && (!to || key <= to);
  }).map((row) => ({ body_log_id: row.body_log_id, measured_at: row.measured_at, weight_kg: numberValue(row.weight_kg) }));
  const detailFields = ['body_fat_pct', 'skeletal_muscle_kg', 'muscle_mass_kg', 'body_water_pct', 'visceral_fat', 'bmr', 'waist_cm'];
  const details = all.filter((row) => detailFields.some((field) => numberValue(row[field]) !== null)).slice(0, 2).map((row) => ({
    measured_at: row.measured_at, measurement_device: row.measurement_device,
    body_fat_pct: numberValue(row.body_fat_pct), skeletal_muscle_kg: numberValue(row.skeletal_muscle_kg), muscle_mass_kg: numberValue(row.muscle_mass_kg),
    body_water_pct: numberValue(row.body_water_pct), visceral_fat: numberValue(row.visceral_fat), bmr: numberValue(row.bmr), waist_cm: numberValue(row.waist_cm),
  }));
  const latest = all.map((row) => numberValue(row.weight_kg)).find((value) => value !== null) ?? null;
  const bmi = latest !== null && user.height !== null && user.height > 0 ? Math.round((latest / ((user.height / 100) ** 2)) * 10) / 10 : null;
  return ok({ weight_trend: trend, detail_records: details, latest_weight_kg: latest, bmi, plan_limits: { weight_days: user.isPremium ? null : 7, detail_records: 2 } });
}

const GROWTH_SHEETS = ['users', 'Training_Logs', 'Training_Sets', 'Body_Composition', 'logs', 'Training_Master', 'Training_Menus', 'Goal_Plans'];

async function growthDispatch(context: RequestContext, userId: string, action: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  await batchSheetValues(context, GROWTH_SHEETS);
  const entries = await Promise.all(GROWTH_SHEETS.map(async (sheetName) => [sheetName, await getRows(context, sheetName)] as const));
  const datasets = Object.fromEntries(entries);
  return growthAction(datasets, userId, action, params) as ApiResult<unknown>;
}

export async function dispatchRead(context: RequestContext, userId: string, action: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  switch (action) {
    case 'getTrainingMaster': return ok({ exercises: await trainingMaster(context) });
    case 'getTrainingMenus': {
      const [user, menus] = await Promise.all([userRecord(context, userId), trainingMenus(context, userId)]);
      return ok({ menus, limit: user.isPremium ? null : 5 });
    }
    case 'getTrainingLogs': return getTrainingLogs(context, userId, params);
    case 'getTrainingLogDetail': return getTrainingLogDetail(context, userId, params);
    case 'getTrainingFormInit': {
      const [user, menus, exercises] = await Promise.all([
        userRecord(context, userId),
        trainingMenus(context, userId),
        trainingMaster(context),
      ]);
      return ok({ menus, limit: user.isPremium ? null : 5, exercises });
    }
    case 'getTrainingBoard': return getTrainingBoard(context, userId);
    case 'getDailyCalorieSummary': return getDailyCalorieSummary(context, userId, params);
    case 'getDashboardAll': return getDashboardAll(context, userId, params);
    case 'getBodyComposition': return getBodyComposition(context, userId, params);
    case 'getGoalPlans': return getGoalPlans(context, userId);
    case 'getNutritionAnalysis': return getNutritionAnalysis(context, userId, params);
    case 'getFoodHistory': return getFoodHistory(context, userId, params);
    case 'getFoodDay': return getFoodDay(context, userId, params);
    case 'getGrowthSummary':
    case 'getGrowthAll':
    case 'getTrainingAnalysis':
    case 'getMenuTrajectory':
    case 'getMealAnalysis':
    case 'getBodyAnalysis':
      return growthDispatch(context, userId, action, params);
    default: return fail('MIGRATION_PENDING', 'このAPI actionはVercel移行の準備中です');
  }
}

export const VERCEL_READ_ACTIONS = new Set([
  'getTrainingMaster', 'getTrainingMenus', 'getTrainingLogs', 'getTrainingLogDetail',
  'getTrainingFormInit', 'getTrainingBoard', 'getDailyCalorieSummary', 'getDashboardAll',
  'getBodyComposition', 'getGoalPlans', 'getNutritionAnalysis', 'getFoodHistory', 'getFoodDay',
  'getGrowthSummary', 'getGrowthAll', 'getTrainingAnalysis', 'getMenuTrajectory', 'getMealAnalysis', 'getBodyAnalysis',
]);
