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