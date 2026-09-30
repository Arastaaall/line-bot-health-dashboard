import { randomUUID } from 'node:crypto';
import { asDate, dateKeyOf, nowIso, todayKey } from './date.ts';
import { findById, getRows } from './sheets.ts';
import type { RequestContext } from './context.ts';
import type { ApiResult, SheetRow } from './types.ts';

export const FORMULA_VERSION = 'v1';
export const CALORIE_MIN = 1;
export const CALORIE_MAX = 3000;
export const STRENGTH_WORK_SEC_PER_SET = 30;
export const STRENGTH_REST_SEC_DEFAULT = 120;
export const ASSUMED_SPEED_KMH: Record<string, number> = { running: 8.0, walking: 4.5, cycling: 20.0, swimming: 2.0 };
export const MET_CATEGORY_VALUES: Record<string, number> = {
  general_weight: 3.5,
  heavy_compound: 5.0,
  high_intensity: 6.0,
  circuit: 5.8,
  bodyweight_general: 3.0,
  bodyweight_vigorous: 6.5,
};
export const RPE_LABEL_MAP: Record<string, number> = {
  楽だった: 2,
  余裕あり: 5,
  まあまあ: 6,
  まあまあきつい: 7,
  かなりきつい: 8,
  限界: 9,
  地獄: 10,
};
export const BODYCOMP_RANGES: Record<string, [number, number]> = {
  weight_kg: [20, 300],
  body_fat_pct: [3, 60],
  skeletal_muscle_kg: [5, 80],
  muscle_mass_kg: [10, 120],
  body_water_pct: [30, 75],
  visceral_fat: [1, 30],
  bmr: [500, 3000],
  waist_cm: [40, 200],
};

export function ok<T>(data: T): ApiResult<T> { return { ok: true, data }; }
export function fail(code: string, message: string): ApiResult<never> { return { ok: false, error: { code, message } }; }
export function notFound(message: string): ApiResult<never> { return fail('NOT_FOUND', message); }

export function text(row: SheetRow, key: string, fallback = ''): string {
  const value = row[key];
  return value === null || value === undefined ? fallback : String(value);
}

export function numberValue(value: unknown, fallback: number | null = null): number | null {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

export function cellNumber(value: unknown): number | string {
  const number = numberValue(value);
  return number === null ? '' : number;
}

export async function userRecord(context: RequestContext, userId: string) {
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

export async function activeTrainingMasters(context: RequestContext): Promise<SheetRow[]> {
  return getRows(context, 'Training_Master', (row) => bool(row.is_active));
}

export async function masterDefaults(context: RequestContext, masterId: unknown): Promise<{
  master_id: unknown;
  exercise_name: string;
  exercise_type: string;
  body_part: string;
  met_category: string;
  default_met_value: number | null;
  is_bodyweight: boolean;
} | null> {
  const id = String(masterId ?? '');
  if (!id) return null;
  const active = await activeTrainingMasters(context);
  const row = active.find((candidate) => text(candidate, 'master_id') === id)
    ?? await findById(context, 'Training_Master', 'master_id', id);
  if (!row) return null;
  return {
    master_id: row.master_id,
    exercise_name: text(row, 'exercise_name'),
    exercise_type: text(row, 'exercise_type', 'other'),
    body_part: text(row, 'body_part', 'other'),
    met_category: text(row, 'met_category'),
    default_met_value: numberValue(row.default_met_value),
    is_bodyweight: bool(row.is_bodyweight),
  };
}

export function deriveInputProfile(master: { exercise_type: string; is_bodyweight: boolean }): string {
  if (master.exercise_type === 'cardio') return 'cardio_basic';
  return master.is_bodyweight ? 'strength_basic' : 'strength_advanced';
}

export function resolveRpe(params: Record<string, unknown>): { rpe: number | null; rpe_source: string } {
  const number = numberValue(params.rpe);
  if (number !== null && number >= 1 && number <= 10) return { rpe: number, rpe_source: 'user' };
  const label = String(params.rpe_label ?? '');
  if (label && Object.prototype.hasOwnProperty.call(RPE_LABEL_MAP, label)) return { rpe: RPE_LABEL_MAP[label], rpe_source: 'converted' };
  return { rpe: null, rpe_source: 'estimated' };
}

export function validateTrainingLogBase(params: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const types = ['strength', 'cardio', 'circuit', 'other'];
  if (!params.training_type || !types.includes(String(params.training_type))) errors.push('training_typeが不正です');
  if (!params.training_date || Number.isNaN(asDate(params.training_date).getTime())) errors.push('training_dateが不正です');
  const duration = numberValue(params.duration_min);
  if (duration !== null && (duration < 1 || duration > 600)) errors.push('duration_minは1〜600です');
  const distance = numberValue(params.distance_km);
  if (distance !== null && (distance <= 0 || distance > 200)) errors.push('distance_kmは0〜200です');
  const sets = Array.isArray(params.sets) ? params.sets : [];
  if (duration === null && distance === null && sets.length === 0) errors.push('時間・距離・セット情報のいずれかが必須です');
  return errors;
}

export function validateSets(sets: unknown): string[] {
  const errors: string[] = [];
  (Array.isArray(sets) ? sets : []).forEach((raw, index) => {
    const set = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const reps = numberValue(set.reps);
    if (reps === null || reps < 1 || reps > 200) errors.push(`sets[${index}].repsは1〜200です`);
    const weight = numberValue(set.weight_kg);
    if (weight !== null && (weight < 0 || weight > 500)) errors.push(`sets[${index}].weight_kgは0〜500です`);
    const rpe = numberValue(set.rpe);
    if (rpe !== null && (rpe < 1 || rpe > 10)) errors.push(`sets[${index}].rpeは1〜10です`);
  });
  return errors;
}

export function detectCardioKind(name: unknown): string | null {
  const value = String(name ?? '');
  if (value.includes('ランニング') || value.includes('ジョギング') || value.includes('トレッドミル')) return 'running';
  if (value.includes('ウォーキング') || value.includes('散歩')) return 'walking';
  if (value.includes('サイクリング') || value.includes('自転車') || value.includes('バイク')) return 'cycling';
  if (value.includes('水泳') || value.includes('スイム')) return 'swimming';
  return null;
}

export function adjustMetBySpeed(kind: string | null, speedKmh: number, fallbackMet: number): number {
  if (kind === 'running') {
    if (speedKmh < 6.4) return 6.0;
    if (speedKmh <= 8.0) return 8.3;
    if (speedKmh <= 9.7) return 9.8;
    if (speedKmh <= 11.3) return 11.0;
    if (speedKmh <= 12.9) return 11.8;
    return 12.8;
  }
  if (kind === 'walking') {
    if (speedKmh < 4.0) return 2.8;
    if (speedKmh <= 5.6) return 3.5;
    if (speedKmh <= 6.4) return 4.3;
    return 5.0;
  }
  if (kind === 'cycling') {
    if (speedKmh < 16) return 4.0;
    if (speedKmh <= 19) return 6.0;
    if (speedKmh <= 22) return 6.8;
    if (speedKmh <= 26) return 8.0;
    return 10.0;
  }
  return fallbackMet;
}

export function clampCalories(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(CALORIE_MIN, Math.min(CALORIE_MAX, Math.round(raw)));
}

export function beginnerMetFromRpe(rpe: unknown): number {
  const number = numberValue(rpe);
  if (number === null || number <= 5) return 3.5;
  if (number <= 7) return 4.5;
  if (number <= 8) return 5.0;
  return 5.5;
}

export function calculateCardioCalories(params: {
  exerciseName: string;
  durationMin: number | null;
  distanceKm: number | null;
  defaultMet: number;
  bodyWeight: number;
}) {
  const kind = detectCardioKind(params.exerciseName);
  let met = params.defaultMet || 3.5;
  let method = 'MET';
  let hours = 0;
  if (params.durationMin) {
    hours = params.durationMin / 60;
    if (params.distanceKm && kind) met = adjustMetBySpeed(kind, params.distanceKm / hours, met);
  } else if (params.distanceKm && kind) {
    hours = params.distanceKm / ASSUMED_SPEED_KMH[kind];
    method = 'MET_standard_speed';
  } else {
    return { calories: 0, met, hours: 0, method };
  }
  return { calories: clampCalories(1.05 * met * params.bodyWeight * hours), met, hours, method };
}

export function calculateStrengthCalories(params: {
  sets: unknown[];
  bodyWeight: number;
  metCategory: string;
  durationMin: number | null;
  rpe: number | null;
}) {
  let met: number;
  let hours: number;
  if (params.sets.length > 0) {
    met = MET_CATEGORY_VALUES[params.metCategory] || MET_CATEGORY_VALUES.general_weight;
    if (params.durationMin) hours = params.durationMin / 60;
    else hours = (STRENGTH_WORK_SEC_PER_SET * params.sets.length + STRENGTH_REST_SEC_DEFAULT * (params.sets.length - 1)) / 3600;
  } else {
    met = beginnerMetFromRpe(params.rpe);
    hours = (params.durationMin || 0) / 60;
  }
  return { calories: clampCalories(1.05 * met * params.bodyWeight * hours), met, hours, method: 'strength_estimation' };
}

export function normalizeMeasuredAt(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const source = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    const currentTime = nowIso().slice(11);
    return asDate(`${source}T${currentTime}`);
  }
  const date = asDate(source);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateBodyComposition(params: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const weight = numberValue(params.weight_kg);
  if (weight === null) errors.push('weight_kgは必須です');
  else if (weight < 20 || weight > 300) errors.push('weight_kgは20〜300の範囲で入力してください');
  if (!params.measured_at) errors.push('measured_atは必須です');
  else {
    const source = String(params.measured_at);
    const date = asDate(source.includes('T') ? source : `${source}T00:00:00`);
    if (Number.isNaN(date.getTime())) errors.push('measured_atの形式が不正です');
    else if (source.includes('T') ? date.getTime() > Date.now() : dateKeyOf(date) > todayKey()) errors.push('measured_atに未来日は指定できません');
  }
  const devices = ['inbody', 'home_scale', 'manual', 'other'];
  if (!params.measurement_device || !devices.includes(String(params.measurement_device))) errors.push('measurement_deviceが不正です');
  Object.entries(BODYCOMP_RANGES).forEach(([key, range]) => {
    if (key === 'weight_kg' || params[key] === undefined || params[key] === null || params[key] === '') return;
    const value = numberValue(params[key]);
    if (value === null || value < range[0] || value > range[1]) errors.push(`${key}は${range[0]}〜${range[1]}の範囲で入力してください`);
  });
  return errors;
}

const LOCK_KEY = 'lock:dashboard-spreadsheet';
const LOCK_TTL_SECONDS = 20;
const LOCK_WAIT_MS = 3000;

export async function withMutationLock<T>(context: RequestContext, fn: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  const owner = randomUUID();
  const startedAt = Date.now();
  let locked = false;
  try {
    while (Date.now() - startedAt <= LOCK_WAIT_MS) {
      if (await context.mutationStore.setIfAbsent(LOCK_KEY, owner, LOCK_TTL_SECONDS)) {
        locked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch {
    return fail('SERVER_ERROR', '一時的に処理を開始できません。しばらくして再度お試しください');
  }
  if (!locked) return fail('SERVER_ERROR', '混み合っています。しばらくして再度お試しください');
  try {
    return await fn();
  } finally {
    try { await context.mutationStore.deleteIfValue(LOCK_KEY, owner); } catch { /* best effort; TTL is the safety net */ }
  }
}

function idempotencyKey(userId: string, action: string, clientId: unknown): string | null {
  const id = String(clientId ?? '').trim();
  return id ? `idempotency:${userId}:${action}:${id}` : null;
}

export async function dedupGet(context: RequestContext, userId: string, action: string, clientId: unknown): Promise<ApiResult<unknown> | null> {
  const key = idempotencyKey(userId, action, clientId);
  if (!key) return null;
  const value = await context.mutationStore.get(key);
  if (!value) return null;
  try { return JSON.parse(value) as ApiResult<unknown>; } catch { return null; }
}

export async function dedupSave(context: RequestContext, userId: string, action: string, clientId: unknown, result: ApiResult<unknown>): Promise<void> {
  const key = idempotencyKey(userId, action, clientId);
  if (!key) return;
  // The store interface intentionally exposes only lock-safe primitives. A
  // dedup result is immutable for its TTL, so set-if-absent is sufficient.
  await context.mutationStore.setIfAbsent(key, JSON.stringify(result), 600);
}

export { asDate, dateKeyOf, findById, getRows, nowIso, todayKey };
