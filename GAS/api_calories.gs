// api_calories.gs — Phase 2 ダッシュボード用サマリー（キャッシュ付き）
function apiGetDailyCalorieSummary(userId, params) {
  perfMark_('calorie_start');
  const dateKey = params.date ? dateKeyOf_(new Date(params.date)) : todayKey_();
  const data = cached_('summary_' + userId + '_' + dateKey, 60, function () {
    perfMark_('calorie_build_start');
    const intakeStart = __perf ? Date.now() : 0;
    const intakeRows = getRows('logs', function (r) {
      return String(r['user_id']) === String(userId) && dateKeyOf_(new Date(r['timestamp'])) === dateKey;
    });
    const intake = intakeRows.reduce(function (sum, r) { return sum + (Number(r['calories']) || 0); }, 0);
    if (__perf) perfAddProcessing_('calorie_intake_filter_reduce_ms', Date.now() - intakeStart);

    const exerciseStart = __perf ? Date.now() : 0;
    const exerciseRows = getRows('Training_Logs', function (r) {
      return String(r['user_id']) === String(userId) && dateKeyOf_(new Date(r['training_date'])) === dateKey;
    });
    const exercise = exerciseRows.reduce(function (sum, r) { return sum + (Number(r['estimated_calories']) || 0); }, 0);
    if (__perf) perfAddProcessing_('calorie_exercise_filter_reduce_ms', Date.now() - exerciseStart);

    const user = getUserRecord_(userId);
    const target = user.targetCalories || 2000;
    const result = {
      date: dateKey,
      target_calories: target,
      intake_calories: intake,
      remaining_calories: target - intake,
      estimated_exercise_calories: exercise,
      exercise_note: 'セット内容等から推定した参考値です'
    };
    perfMark_('calorie_build_end');
    return result;
  });
  perfMark_('calorie_end');
  return { ok: true, data: data };
}
