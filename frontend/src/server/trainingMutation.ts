import type { RequestContext } from './context.ts';
import { appendRowsRequest, deleteRowsRequest, findRowPosition, metadata, rowsByForeignKey, sheetHeader, updateCellsRequest, writeBatch } from './sheetsWrite.ts';
import type { ApiResult, SheetRow } from './types.ts';
import {
  FORMULA_VERSION,
  calculateCardioCalories,
  calculateStrengthCalories,
  cellNumber,
  dateKeyOf,
  dedupGet,
  dedupSave,
  deriveInputProfile,
  fail,
  findById,
  getRows,
  masterDefaults,
  notFound,
  nowIso,
  numberValue,
  ok,
  resolveRpe,
  text,
  todayKey,
  userRecord,
  validateSets,
  validateTrainingLogBase,
  withMutationLock,
} from './mutationCommon.ts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function setRows(logId: string, sets: unknown[], now: string): SheetRow[] {
  return sets.map((raw, index) => {
    const set = record(raw);
    const isBodyweight = set.is_bodyweight === true || set.is_bodyweight === 1 || set.is_bodyweight === '1' || String(set.is_bodyweight).toLowerCase() === 'true';
    const rawWeight = numberValue(set.weight_kg);
    return {
      set_id: `ts_${crypto.randomUUID()}`,
      training_log_id: logId,
      set_no: index + 1,
      weight_kg: isBodyweight && rawWeight === null ? 0 : cellNumber(set.weight_kg),
      reps: numberValue(set.reps, 0) ?? 0,
      rpe: cellNumber(set.rpe),
      is_bodyweight: isBodyweight,
      duration_sec: cellNumber(set.duration_sec),
      rest_sec: cellNumber(set.rest_sec),
      memo: set.memo || '',
      created_at: now,
    };
  });
}

async function appendAtomic(context: RequestContext, log: SheetRow, sets: SheetRow[]): Promise<void> {
  const [properties, logHeader, setHeader] = await Promise.all([
    metadata(context),
    sheetHeader(context, 'Training_Logs'),
    sheetHeader(context, 'Training_Sets'),
  ]);
  await writeBatch(context, [
    appendRowsRequest(properties, 'Training_Logs', logHeader, [log]),
    ...(sets.length ? [appendRowsRequest(properties, 'Training_Sets', setHeader, sets)] : []),
  ], ['Training_Logs', 'Training_Sets']);
}

async function resolveMenuAndMaster(
  context: RequestContext,
  userId: string,
  params: Record<string, unknown>,
): Promise<{ menu: SheetRow | null; masterId: string; exerciseName: string; metCategory: string; defaultMet: number | null } | { ok: false; error: { code: string; message: string } }> {
  let masterId = String(params.master_id ?? '');
  let exerciseName = String(params.exercise_name ?? '').trim();
  if (params.menu_id) {
    const menu = await findById(context, 'Training_Menus', 'menu_id', params.menu_id);
    if (!menu || text(menu, 'user_id') !== userId) return notFound('menu_idが見つかりません') as { ok: false; error: { code: string; message: string } };
    if (!exerciseName) exerciseName = text(menu, 'menu_name');
    if (!masterId) masterId = text(menu, 'master_id');
  }
  let metCategory = '';
  let defaultMet: number | null = null;
  if (masterId) {
    const master = await masterDefaults(context, masterId);
    if (master) {
      if (!exerciseName) exerciseName = master.exercise_name;
      metCategory = master.met_category;
      defaultMet = master.default_met_value;
    }
  }
  return { menu: null, masterId, exerciseName, metCategory, defaultMet };
}

function calculation(
  params: Record<string, unknown>,
  exerciseName: string,
  metCategory: string,
  defaultMet: number | null,
  bodyWeight: number,
  rpe: number | null,
) {
  const sets = Array.isArray(params.sets) ? params.sets : [];
  if (params.training_type === 'cardio') {
    return calculateCardioCalories({
      exerciseName,
      durationMin: numberValue(params.duration_min),
      distanceKm: numberValue(params.distance_km),
      defaultMet: defaultMet || 3.5,
      bodyWeight,
    });
  }
  return calculateStrengthCalories({
    sets,
    bodyWeight,
    metCategory,
    durationMin: numberValue(params.duration_min),
    rpe,
  });
}

function logRow(
  userId: string,
  params: Record<string, unknown>,
  logId: string,
  masterId: string,
  exerciseName: string,
  bodyWeight: number,
  rpeResolved: { rpe: number | null; rpe_source: string },
  calc: { calories: number; method: string },
  now: string,
): SheetRow {
  return {
    training_log_id: logId,
    user_id: userId,
    menu_id: params.menu_id || '',
    master_id: masterId,
    exercise_name_snapshot: exerciseName,
    training_type: params.training_type,
    training_date: params.training_date,
    duration_min: cellNumber(params.duration_min),
    distance_km: cellNumber(params.distance_km),
    incline_pct: cellNumber(params.incline_pct),
    rpe: rpeResolved.rpe === null ? '' : rpeResolved.rpe,
    rpe_source: rpeResolved.rpe_source,
    estimated_calories: calc.calories,
    calorie_estimation_method: calc.method,
    calorie_formula_version: FORMULA_VERSION,
    body_weight: bodyWeight,
    memo: params.memo || '',
    created_at: now,
    updated_at: now,
  };
}

async function createTrainingLogLocked(context: RequestContext, userId: string, params: Record<string, unknown>, action: string): Promise<ApiResult<unknown>> {
  const duplicate = await dedupGet(context, userId, action, params.client_id);
  if (duplicate) return duplicate;
  const user = await userRecord(context, userId);
  const dateKey = params.training_date ? dateKeyOf(params.training_date) : todayKey();
  if (!user.isPremium) {
    const count = (await getRows(context, 'Training_Logs', (row) => text(row, 'user_id') === userId && dateKeyOf(row.training_date) === dateKey)).length;
    if (count >= 7) return fail('LIMIT_EXCEEDED', '無料プランは1日7件までです');
  }
  const errors = validateTrainingLogBase(params).concat(validateSets(params.sets));
  if (errors.length) return fail('VALIDATION_ERROR', errors.join(' / '));
  const resolved = await resolveMenuAndMaster(context, userId, params);
  if ('error' in resolved) return resolved;
  if (!resolved.exerciseName) return fail('VALIDATION_ERROR', 'exercise_nameは必須です');
  const rpeResolved = resolveRpe(params);
  const bodyWeight = user.weight ?? 60;
  const calc = calculation(params, resolved.exerciseName, resolved.metCategory, resolved.defaultMet, bodyWeight, rpeResolved.rpe);
  const now = nowIso();
  const logId = `tl_${crypto.randomUUID()}`;
  const rows = setRows(logId, Array.isArray(params.sets) ? params.sets : [], now);
  await appendAtomic(context, logRow(userId, params, logId, resolved.masterId, resolved.exerciseName, bodyWeight, rpeResolved, calc, now), rows);
  const result = ok({ training_log_id: logId, estimated_calories: calc.calories, calorie_estimation_method: calc.method, calorie_formula_version: FORMULA_VERSION, body_weight: bodyWeight });
  await dedupSave(context, userId, action, params.client_id, result);
  return result;
}

export async function createTrainingMenu(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const duplicate = await dedupGet(context, userId, 'createTrainingMenu', params.client_id);
    if (duplicate) return duplicate;
    const user = await userRecord(context, userId);
    if (!user.isPremium) {
      const count = (await getRows(context, 'Training_Menus', (row) => text(row, 'user_id') === userId && boolActive(row.is_active))).length;
      if (count >= 5) return fail('LIMIT_EXCEEDED', '無料プランのマイメニューは5件までです');
    }
    const name = String(params.menu_name ?? '').trim();
    if (!name) return fail('VALIDATION_ERROR', 'menu_nameは必須です');
    let trainingType = String(params.training_type ?? 'other');
    let inputProfile = String(params.input_profile ?? '');
    let bodyPart = String(params.body_part ?? 'other');
    const masterId = String(params.master_id ?? '');
    if (masterId) {
      const master = await masterDefaults(context, masterId);
      if (!master) return notFound('master_idが見つかりません') as { ok: false; error: { code: string; message: string } };
      trainingType = master.exercise_type;
      inputProfile = deriveInputProfile(master);
      bodyPart = String(params.body_part || master.body_part);
    }
    if (!inputProfile) inputProfile = 'strength_basic';
    const existing = await getRows(context, 'Training_Menus', (row) => text(row, 'user_id') === userId);
    const maxOrder = existing.reduce((max, row) => Math.max(max, numberValue(row.display_order, 0) ?? 0), 0);
    const now = nowIso();
    const menuId = `tmu_${crypto.randomUUID()}`;
    const menu = {
      menu_id: menuId, user_id: userId, master_id: masterId,
      training_group: String(params.training_group || 'その他'), body_part: bodyPart, menu_name: name,
      training_type: trainingType, input_profile: inputProfile, display_order: maxOrder + 1,
      is_active: true, created_at: now, updated_at: now,
    };
    const [properties, header] = await Promise.all([metadata(context), sheetHeader(context, 'Training_Menus')]);
    await writeBatch(context, [appendRowsRequest(properties, 'Training_Menus', header, [menu])], ['Training_Menus']);
    const result = ok({ menu_id: menuId });
    await dedupSave(context, userId, 'createTrainingMenu', params.client_id, result);
    return result;
  });
}

function boolActive(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

export async function updateTrainingMenu(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const found = await findRowPosition(context, 'Training_Menus', 'menu_id', params.menu_id);
    if (!found || text(found.row, 'user_id') !== userId) return notFound('メニューが見つかりません');
    const patch: SheetRow = { updated_at: nowIso() };
    if (params.display_order !== undefined && params.display_order !== null) patch.display_order = numberValue(params.display_order, 0) ?? 0;
    if (params.menu_name) patch.menu_name = String(params.menu_name).trim();
    if (params.training_group !== undefined) patch.training_group = String(params.training_group || 'その他');
    const properties = await metadata(context);
    await writeBatch(context, updateCellsRequest(properties, 'Training_Menus', found.rowNumber, found.header, patch), ['Training_Menus']);
    return ok({ menu_id: params.menu_id });
  });
}

export async function updateTrainingMenuOrder(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const orders = Array.isArray(params.orders) ? params.orders.map(record) : [];
    if (!orders.length) return ok({});
    const ids = orders.map((order) => String(order.menu_id));
    const mine = await getRows(context, 'Training_Menus', (row) => text(row, 'user_id') === userId && ids.includes(text(row, 'menu_id')));
    if (mine.length !== ids.length) return notFound('メニューが見つかりません');
    const properties = await metadata(context);
    const requests: Record<string, unknown>[] = [];
    for (const order of orders) {
      const found = await findRowPosition(context, 'Training_Menus', 'menu_id', order.menu_id);
      if (!found || text(found.row, 'user_id') !== userId) return notFound('メニューが見つかりません');
      requests.push(...updateCellsRequest(properties, 'Training_Menus', found.rowNumber, found.header, {
        display_order: numberValue(order.display_order, 0) ?? 0,
        training_group: String(order.training_group || 'その他'),
        updated_at: nowIso(),
      }));
    }
    await writeBatch(context, requests, ['Training_Menus']);
    return ok({});
  });
}

export async function deleteTrainingMenu(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const found = await findRowPosition(context, 'Training_Menus', 'menu_id', params.menu_id);
    if (!found || text(found.row, 'user_id') !== userId) return notFound('メニューが見つかりません');
    const properties = await metadata(context);
    await writeBatch(context, updateCellsRequest(properties, 'Training_Menus', found.rowNumber, found.header, { is_active: false, updated_at: nowIso() }), ['Training_Menus']);
    return ok({ menu_id: params.menu_id });
  });
}

export async function createTrainingLog(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, () => createTrainingLogLocked(context, userId, params, 'createTrainingLog'));
}

export async function createTrainingLogsBatch(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const duplicate = await dedupGet(context, userId, 'createTrainingLogsBatch', params.client_id);
    if (duplicate) return duplicate;
    const user = await userRecord(context, userId);
    const logs = Array.isArray(params.logs) ? params.logs.map(record) : [];
    if (!logs.length) return fail('VALIDATION_ERROR', 'ログが指定されていません');
    if (!user.isPremium) {
      const todayCount = (await getRows(context, 'Training_Logs', (row) => text(row, 'user_id') === userId && dateKeyOf(row.training_date) === todayKey())).length;
      if (todayCount + logs.length > 7) return fail('LIMIT_EXCEEDED', `無料プランは1日7件までです（本日${todayCount}件登録済み）`);
    }
    const results: Array<Record<string, unknown>> = [];
    for (const [index, log] of logs.entries()) {
      const errors = validateTrainingLogBase(log).concat(validateSets(log.sets));
      if (errors.length) { results.push({ index, ok: false, error: errors.join(' / ') }); continue; }
      const resolved = await resolveMenuAndMaster(context, userId, log);
      if ('error' in resolved) { results.push({ index, ok: false, error: resolved.error.message }); continue; }
      if (!resolved.exerciseName) { results.push({ index, ok: false, error: 'exercise_nameは必須です' }); continue; }
      const rpeResolved = resolveRpe(log);
      const bodyWeight = user.weight ?? 60;
      const calc = calculation(log, resolved.exerciseName, resolved.metCategory, resolved.defaultMet, bodyWeight, rpeResolved.rpe);
      const now = nowIso();
      const logId = `tl_${crypto.randomUUID()}`;
      const resultData = { training_log_id: logId, estimated_calories: calc.calories, calorie_estimation_method: calc.method, calorie_formula_version: FORMULA_VERSION, body_weight: bodyWeight };
      try {
        await appendAtomic(context, logRow(userId, log, logId, resolved.masterId, resolved.exerciseName, bodyWeight, rpeResolved, calc, now), setRows(logId, Array.isArray(log.sets) ? log.sets : [], now));
        results.push({ index, ok: true, data: resultData });
      } catch {
        results.push({ index, ok: false, error: 'ログの保存に失敗しました' });
      }
    }
    const allOk = results.every((result) => result.ok === true);
    const data = { results, count: results.length };
    const result = ok(data);
    const finalResult: ApiResult<unknown> = allOk ? result : { ok: false, data } as unknown as ApiResult<unknown>;
    if (allOk) await dedupSave(context, userId, 'createTrainingLogsBatch', params.client_id, finalResult);
    return finalResult;
  });
}

export async function updateTrainingLog(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const found = await findRowPosition(context, 'Training_Logs', 'training_log_id', params.training_log_id);
    if (!found || text(found.row, 'user_id') !== userId) return notFound('ログが見つかりません');
    const patch: SheetRow = { updated_at: nowIso() };
    ['training_date', 'duration_min', 'distance_km', 'incline_pct', 'memo'].forEach((key) => {
      if (params[key] !== undefined) patch[key] = params[key];
    });
    if (params.rpe !== undefined || params.rpe_label !== undefined) {
      const rpe = resolveRpe(params);
      patch.rpe = rpe.rpe === null ? '' : rpe.rpe;
      patch.rpe_source = rpe.rpe_source;
    }
    const hasSets = params.sets !== undefined;
    const sets = hasSets && Array.isArray(params.sets) ? params.sets : [];
    if (hasSets) {
      const errors = validateSets(sets);
      if (errors.length) return fail('VALIDATION_ERROR', errors.join(' / '));
    }
    const bodyWeight = numberValue(found.row.body_weight, 60) ?? 60;
    const merged = { ...found.row, ...patch };
    const master = await masterDefaults(context, found.row.master_id);
    let calc;
    if (text(found.row, 'training_type') === 'cardio') {
      calc = calculateCardioCalories({ exerciseName: text(found.row, 'exercise_name_snapshot'), durationMin: numberValue(merged.duration_min), distanceKm: numberValue(merged.distance_km), defaultMet: master?.default_met_value || 3.5, bodyWeight });
    } else {
      const existingSets = hasSets ? sets : (await getRows(context, 'Training_Sets', (row) => text(row, 'training_log_id') === String(params.training_log_id)));
      calc = calculateStrengthCalories({ sets: existingSets, bodyWeight, metCategory: master?.met_category ?? '', durationMin: numberValue(merged.duration_min), rpe: numberValue(merged.rpe) });
    }
    patch.estimated_calories = calc.calories;
    patch.calorie_estimation_method = calc.method;
    patch.calorie_formula_version = FORMULA_VERSION;
    const properties = await metadata(context);
    const requests = updateCellsRequest(properties, 'Training_Logs', found.rowNumber, found.header, patch);
    const touched = ['Training_Logs'];
    if (hasSets) {
      const oldSets = await rowsByForeignKey(context, 'Training_Sets', 'training_log_id', params.training_log_id);
      requests.push(...deleteRowsRequest(properties, 'Training_Sets', oldSets.map((set) => set.rowNumber)));
      if (sets.length) requests.push(appendRowsRequest(properties, 'Training_Sets', await sheetHeader(context, 'Training_Sets'), setRows(String(params.training_log_id), sets, nowIso())));
      touched.push('Training_Sets');
    }
    await writeBatch(context, requests, touched);
    return ok({ training_log_id: params.training_log_id, estimated_calories: calc.calories, calorie_formula_version: FORMULA_VERSION });
  });
}

export async function deleteTrainingLog(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const found = await findRowPosition(context, 'Training_Logs', 'training_log_id', params.training_log_id);
    if (!found || text(found.row, 'user_id') !== userId) return notFound('ログが見つかりません');
    const properties = await metadata(context);
    const sets = await rowsByForeignKey(context, 'Training_Sets', 'training_log_id', params.training_log_id);
    const requests = deleteRowsRequest(properties, 'Training_Sets', sets.map((set) => set.rowNumber));
    requests.push(...deleteRowsRequest(properties, 'Training_Logs', [found.rowNumber]));
    await writeBatch(context, requests, ['Training_Logs', 'Training_Sets']);
    return ok({ deleted: true });
  });
}

export async function dispatchTrainingMutation(context: RequestContext, userId: string, action: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  switch (action) {
    case 'createTrainingMenu': return createTrainingMenu(context, userId, params);
    case 'updateTrainingMenu': return updateTrainingMenu(context, userId, params);
    case 'updateTrainingMenuOrder': return updateTrainingMenuOrder(context, userId, params);
    case 'deleteTrainingMenu': return deleteTrainingMenu(context, userId, params);
    case 'createTrainingLog': return createTrainingLog(context, userId, params);
    case 'createTrainingLogsBatch': return createTrainingLogsBatch(context, userId, params);
    case 'updateTrainingLog': return updateTrainingLog(context, userId, params);
    case 'deleteTrainingLog': return deleteTrainingLog(context, userId, params);
    default: return fail('NOT_FOUND', `Unknown mutation action: ${action}`);
  }
}
