// validators.gs
const RPE_LABEL_MAP = {
  '楽だった': 2,
  '余裕あり': 5,
  'まあまあ': 6,
  'まあまあきつい': 7,
  'かなりきつい': 8,
  '限界': 9,
  '地獄': 10
};

// rpe数値 > rpe_label の優先順で解決
function resolveRpe_(params) {
  const num = toNumber_(params.rpe, null);
  if (num !== null && num >= 1 && num <= 10) return { rpe: num, rpe_source: 'user' };
  const label = params.rpe_label;
  if (label && RPE_LABEL_MAP.hasOwnProperty(label)) return { rpe: RPE_LABEL_MAP[label], rpe_source: 'converted' };
  return { rpe: null, rpe_source: 'estimated' };
}

function validateTrainingLogBase_(p) {
  const errors = [];
  const types = ['strength', 'cardio', 'circuit', 'other'];
  if (!p.training_type || types.indexOf(p.training_type) === -1) errors.push('training_typeが不正です');
  if (!p.training_date || isNaN(new Date(p.training_date).getTime())) errors.push('training_dateが不正です');
  const duration = toNumber_(p.duration_min, null);
  if (duration !== null && (duration < 1 || duration > 600)) errors.push('duration_minは1〜600です');
  const distance = toNumber_(p.distance_km, null);
  if (distance !== null && (distance <= 0 || distance > 200)) errors.push('distance_kmは0〜200です');
  if (duration === null && distance === null && (p.sets || []).length === 0) {
    errors.push('時間・距離・セット情報のいずれかが必須です');
  }
  return errors;
}

function validateSets_(sets) {
  const errors = [];
  (sets || []).forEach(function (s, i) {
    const reps = toNumber_(s.reps, null);
    if (reps === null || reps < 1 || reps > 200) errors.push('sets[' + i + '].repsは1〜200です');
    const w = toNumber_(s.weight_kg, null);
    if (w !== null && (w < 0 || w > 500)) errors.push('sets[' + i + '].weight_kgは0〜500です');
    const rpe = toNumber_(s.rpe, null);
    if (rpe !== null && (rpe < 1 || rpe > 10)) errors.push('sets[' + i + '].rpeは1〜10です');
  });
  return errors;
}

// ---------- Phase 3 体組成バリデーション ----------
const BODYCOMP_RANGES = {
  weight_kg: [20, 300],
  body_fat_pct: [3, 60],
  skeletal_muscle_kg: [5, 80],
  muscle_mass_kg: [10, 120],
  body_water_pct: [30, 75],
  visceral_fat: [1, 30],
  bmr: [500, 3000],
  waist_cm: [40, 200]
};

function validateBodyComposition_(params) {
  const errors = [];
  const w = toNumber_(params.weight_kg, null);
  if (w === null) errors.push('weight_kgは必須です');
  else if (w < 20 || w > 300) errors.push('weight_kgは20〜300の範囲で入力してください');

  if (!params.measured_at) errors.push('measured_atは必須です');
  else if (isNaN(new Date(String(params.measured_at).indexOf('T') !== -1 ? params.measured_at : params.measured_at + 'T00:00:00').getTime())) errors.push('measured_atの形式が不正です');
  else if (new Date(String(params.measured_at).indexOf('T') !== -1 ? params.measured_at : params.measured_at + 'T23:59:59').getTime() > Date.now()) errors.push('measured_atに未来日は指定できません');

  const devices = ['inbody', 'home_scale', 'manual', 'other']; // migrationはMigration専用
  if (!params.measurement_device || devices.indexOf(params.measurement_device) === -1) {
    errors.push('measurement_deviceが不正です');
  }

  Object.keys(BODYCOMP_RANGES).forEach(function (k) {
    if (k === 'weight_kg') return;
    if (params[k] === undefined || params[k] === null || params[k] === '') return;
    const v = toNumber_(params[k], null);
    const range = BODYCOMP_RANGES[k];
    if (v === null || v < range[0] || v > range[1]) {
      errors.push(k + 'は' + range[0] + '〜' + range[1] + 'の範囲で入力してください');
    }
  });

  return errors;
}