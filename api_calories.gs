// api_calories.gs — Phase 2 ダッシュボード用サマリー（キャッシュ付き）
function apiGetDailyCalorieSummary(userId, params) {
  const dateKey = params.date ? dateKeyOf_(new Date(params.date)) : todayKey_();
  const data = cached_('summary_' + userId + '_' + dateKey, 60, function () {
    const intake = getRows('logs', function (r) {
      return String(r['user_id']) === String(userId) && dateKeyOf_(new Date(r['timestamp'])) === dateKey;
    }).reduce(function (sum, r) { return sum + (Number(r['calories']) || 0); }, 0);

    const exercise = getRows('Training_Logs', function (r) {
      return String(r['user_id']) === String(userId) && dateKeyOf_(new Date(r['training_date'])) === dateKey;
    }).reduce(function (sum, r) { return sum + (Number(r['estimated_calories']) || 0); }, 0);

    const user = getUserRecord_(userId);
    const target = user.targetCalories || 2000;
    return {
      date: dateKey,
      target_calories: target,
      intake_calories: intake,
      remaining_calories: target - intake,
      estimated_exercise_calories: exercise,
      exercise_note: 'セット内容等から推定した参考値です'
    };
  });
  return { ok: true, data: data };
}
// ===== Phase 4/5 専用 日次集計ヘルパー（Phase6コードには触れない） =====
// logsをJST日次で集計。NULL/空欄は0。recorded_days=戻り値のlength
function nfDailyMealSummary_(userId, fromKey, toKey) {
  const rows = getRows('logs', function (r) { return String(r['user_id']) === String(userId); });
  const days = {};
  rows.forEach(function (r) {
    const k = dateKeyOf_(new Date(r['timestamp']));
    if ((fromKey && k < fromKey) || k > toKey) return;
    if (!days[k]) days[k] = { date: k, meals_count: 0, calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, calcium: 0, iron: 0, potassium: 0, magnesium: 0, zinc: 0, vit_a: 0, vit_c: 0 };
    const d = days[k];
    d.meals_count += 1;
    d.calories += Number(r['calories']) || 0;
    d.protein += Number(r['protein']) || 0;
    d.fat += Number(r['fat']) || 0;
    d.carbs += Number(r['carbs']) || 0;
    d.fiber += Number(r['fiber']) || 0;
    d.calcium += Number(r['calcium']) || 0;
    d.iron += Number(r['iron']) || 0;
    d.potassium += Number(r['potassium']) || 0;
    d.magnesium += Number(r['magnesium']) || 0;
    d.zinc += Number(r['zinc']) || 0;
    d.vit_a += Number(r['vit_a']) || 0;
    d.vit_c += Number(r['vit_c']) || 0;
  });
  return Object.keys(days).sort().map(function (k) { return days[k]; });
}