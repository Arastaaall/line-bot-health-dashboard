// calculators.gs — 推定消費カロリー v1
const CALORIE_MIN = 1;
const CALORIE_MAX = 3000;
const FORMULA_VERSION = 'v1';

// 筋トレ: met_category固定値（独自加算・部位補正は廃止）
const MET_CATEGORY_VALUES = {
  general_weight: 3.5,
  heavy_compound: 5.0,
  high_intensity: 6.0,
  circuit: 5.8,
  bodyweight_general: 3.0,
  bodyweight_vigorous: 6.5
};
const STRENGTH_WORK_SEC_PER_SET = 30;
const STRENGTH_REST_SEC_DEFAULT = 120;

// 標準速度（距離のみの場合の推定用）
const ASSUMED_SPEED_KMH = { running: 8.0, walking: 4.5, cycling: 20.0, swimming: 2.0 };

function detectCardioKind_(name) {
  const n = String(name || '');
  if (n.indexOf('ランニング') !== -1 || n.indexOf('ジョギング') !== -1 || n.indexOf('トレッドミル') !== -1) return 'running';
  if (n.indexOf('ウォーキング') !== -1 || n.indexOf('散歩') !== -1) return 'walking';
  if (n.indexOf('サイクリング') !== -1 || n.indexOf('自転車') !== -1 || n.indexOf('バイク') !== -1) return 'cycling';
  if (n.indexOf('水泳') !== -1 || n.indexOf('スイム') !== -1) return 'swimming';
  return null;
}

// Compendium準拠 速度→MET
function adjustMetBySpeed(kind, speedKmh, fallbackMet) {
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

function clampCalories_(raw) {
  if (!isFinite(raw) || raw <= 0) return 0;
  return Math.max(CALORIE_MIN, Math.min(CALORIE_MAX, Math.round(raw)));
}

function beginnerMetFromRpe_(rpe) {
  const r = toNumber_(rpe, null);
  if (r === null) return 3.5;
  if (r <= 5) return 3.5;
  if (r <= 7) return 4.5;
  if (r <= 8) return 5.0;
  return 5.5;
}

// 有酸素。v1は勾配補正なし（incline_pctは保存のみ）
function calculateCardioCalories(p) {
  const kind = detectCardioKind_(p.exerciseName);
  let met = p.defaultMet || 3.5;
  let method = 'MET';
  let hours;

  if (p.duration_min) {
    hours = p.duration_min / 60;
    if (p.distance_km && kind) {
      met = adjustMetBySpeed(kind, p.distance_km / hours, met); // ←速度補正（必須）
    }
  } else if (p.distance_km && kind) {
    const assumed = ASSUMED_SPEED_KMH[kind];
    hours = p.distance_km / assumed;
    method = 'MET_standard_speed';
  } else {
    return { calories: 0, met: met, hours: 0, method: method };
  }

  const raw = 1.05 * met * p.body_weight * hours;
  return { calories: clampCalories_(raw), met: met, hours: hours, method: method };
}
// 筋トレ/サーキット。時間 = work×sets + rest×(sets-1)
function calculateStrengthCalories(p) {
  const sets = p.sets || [];
  let met, hours;

  if (sets.length > 0) {
    met = MET_CATEGORY_VALUES[p.metCategory] || MET_CATEGORY_VALUES.general_weight;
    if (p.duration_min) {
      hours = p.duration_min / 60;
    } else {
      const sec = STRENGTH_WORK_SEC_PER_SET * sets.length + STRENGTH_REST_SEC_DEFAULT * (sets.length - 1);
      hours = sec / 3600;
    }
  } else {
    met = beginnerMetFromRpe_(p.rpe);
    hours = (p.duration_min || 0) / 60;
  }

  const raw = 1.05 * met * p.body_weight * hours;
  return { calories: clampCalories_(raw), met: met, hours: hours, method: 'strength_estimation' };
}