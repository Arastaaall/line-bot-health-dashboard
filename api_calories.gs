// api_calories.gs — Phase 2 ダッシュボード用サマリー
function apiGetDailyCalorieSummary(userId, params) {
  const user = getUserRecord_(userId);
  const dateKey = params.date ? dateKeyOf_(new Date(params.date)) : todayKey_();

  // 摂取カロリー（Logsシート＝食事記録）
  const intake = getRows('logs', function (r) {
    return String(r['user_id']) === String(userId) && dateKeyOf_(new Date(r['timestamp'])) === dateKey;
  }).reduce(function (sum, r) { return sum + (Number(r['calories']) || 0); }, 0);

  // 推定運動消費（Training_Logs）※摂取と完全分離
  const exercise = getRows('Training_Logs', function (r) {
    return String(r['user_id']) === String(userId) && dateKeyOf_(new Date(r['training_date'])) === dateKey;
  }).reduce(function (sum, r) { return sum + (Number(r['estimated_calories']) || 0); }, 0);

  const target = user.targetCalories || 2000;
  return { ok: true, data: {
    date: dateKey,
    target_calories: target,
    intake_calories: intake,
    remaining_calories: target - intake,
    estimated_exercise_calories: exercise,
    exercise_note: 'セット内容等から推定した参考値です'
  } };
}

// 手動スモークテスト（エディタで1回実行してLogger確認、後は放置でOK）
function __smokeTest() {
  Logger.log(JSON.stringify(apiGetTrainingMaster('x', {})).slice(0, 200));
  // 有酸素: 30分/5km → 速度10km/h → MET 11.0 → 375 kcal (体重65想定)
  Logger.log(JSON.stringify(calculateCardioCalories({ exerciseName: 'ランニング', duration_min: 30, distance_km: 5, defaultMet: 9.8, body_weight: 65 })));
  // 有酸素: 距離のみ5km → 標準速度8.0 → 0.625h × MET 9.8 → 418 kcal
  Logger.log(JSON.stringify(calculateCardioCalories({ exerciseName: 'ランニング', duration_min: null, distance_km: 5, defaultMet: 9.8, body_weight: 65 })));
  // 筋トレ: 3セット heavy_compound → 時間 330秒 → 31 kcal
  Logger.log(JSON.stringify(calculateStrengthCalories({ sets: [{}, {}, {}], body_weight: 65, metCategory: 'heavy_compound', duration_min: null, rpe: null })));
}