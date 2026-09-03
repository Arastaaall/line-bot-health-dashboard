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