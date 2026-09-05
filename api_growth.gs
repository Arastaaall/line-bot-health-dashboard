// api_growth.gs — Phase 6 成長の記録（読取専用: append/update/delete不使用）

function apiGetGrowthSummary(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || '7d');
  if (['7d', '30d', '90d', '1y', 'all'].indexOf(range) === -1) range = '7d';
  if (!user.isPremium) range = '7d';

  const data = cached_('growth_' + userId + '_' + range, 120, function () {
    return buildGrowthSummary_(userId, range, user.isPremium);
  });
  return { ok: true, data: data };
}

function buildGrowthSummary_(userId, range, isPremium) {
  const to = todayKey_();
  let from = null;
  if (range === '7d') { const d = new Date(); d.setDate(d.getDate() - 6); from = dateKeyOf_(d); }
  else if (range === '30d') { const d = new Date(); d.setDate(d.getDate() - 29); from = dateKeyOf_(d); }
  else if (range === '90d') { const d = new Date(); d.setDate(d.getDate() - 89); from = dateKeyOf_(d); }
  else if (range === '1y') { const d = new Date(); d.setDate(d.getDate() - 364); from = dateKeyOf_(d); }

  const weekly = (range === '1y' || range === 'all');

  function bucketKey(k) {
    if (!weekly) return k;
    const d = new Date(k + 'T00:00:00');
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // 月曜へ
    return dateKeyOf_(d);
  }
  const inRange = function (k) { return (!from || k >= from) && k <= to; };

  // ---- 一括読み込み ----
  const tLogs = getRows('Training_Logs', function (r) {
    return String(r['user_id']) === String(userId) && inRange(dateKeyOf_(new Date(r['training_date'])));
  });
  const logBucket = {};
  const logExKey = {};
  tLogs.forEach(function (l) {
    const id = String(l['training_log_id']);
    logBucket[id] = bucketKey(dateKeyOf_(new Date(l['training_date'])));
    const mid = String(l['master_id'] || '');
    logExKey[id] = mid !== '' ? mid : String(l['exercise_name_snapshot']);
  });
  const tSets = getRows('Training_Sets', function (s) { return !!logBucket[String(s['training_log_id'])]; });
  const bLogs = getRows('Body_Composition', function (r) {
    return String(r['user_id']) === String(userId) && inRange(dateKeyOf_(new Date(r['measured_at'])));
  });
  const mLogs = getRows('logs', function (r) {
    return String(r['user_id']) === String(userId) && inRange(dateKeyOf_(new Date(r['timestamp'])));
  });

  // ---- training_daily / totals（estimated_kcalは保存値SUM・再計算しない） ----
  const tMap = {};
  tLogs.forEach(function (l) {
    const k = logBucket[String(l['training_log_id'])];
    if (!tMap[k]) tMap[k] = { volume_kg: 0, exercise_logs: 0, cardio_min: 0, estimated_kcal: 0 };
    tMap[k].exercise_logs += 1;
    tMap[k].cardio_min += toNumber_(l['duration_min'], 0) || 0;
    tMap[k].estimated_kcal += toNumber_(l['estimated_calories'], 0) || 0;
  });
  let totalVolume = 0;
  tSets.forEach(function (s) {
    const k = logBucket[String(s['training_log_id'])];
    if (!k) return;
    const w = toNumber_(s['weight_kg'], null);
    const reps = toNumber_(s['reps'], 0) || 0;
    if (w !== null && w > 0) {
      tMap[k].volume_kg += w * reps;
      totalVolume += w * reps;
    }
  });

  function dailySeries(map, valueFn) {
    if (range === 'all') return Object.keys(map).sort().map(valueFn); // allは全期間埋めしない
    const keys = [];
    const cur = new Date((weekly ? bucketKey(from) : from) + 'T00:00:00');
    const end = new Date((weekly ? bucketKey(to) : to) + 'T00:00:00');
    while (cur <= end) {
      keys.push(dateKeyOf_(cur));
      cur.setDate(cur.getDate() + (weekly ? 7 : 1));
    }
    return keys.map(valueFn);
  }

  const trainingDaily = dailySeries(tMap, function (k) {
    const b = tMap[k] || { volume_kg: 0, exercise_logs: 0, cardio_min: 0, estimated_kcal: 0 };
    return { date: k, volume_kg: b.volume_kg, exercise_logs: b.exercise_logs, cardio_min: b.cardio_min, estimated_kcal: b.estimated_kcal };
  });

  const activeDays = {};
  tLogs.forEach(function (l) { activeDays[dateKeyOf_(new Date(l['training_date']))] = true; });

  const trainingTotals = {
    volume_kg: totalVolume,
    exercise_logs: tLogs.length,
    active_days: Object.keys(activeDays).length,
    cardio_min: tLogs.reduce(function (s, l) { return s + (toNumber_(l['duration_min'], 0) || 0); }, 0),
    estimated_kcal: tLogs.reduce(function (s, l) { return s + (toNumber_(l['estimated_calories'], 0) || 0); }, 0)
  };

  // ---- exercise_stats（未登録含む） ----
  const eMap = {};
  tLogs.forEach(function (l) {
    const key = logExKey[String(l['training_log_id'])];
    if (!eMap[key]) {
      const mid = String(l['master_id'] || '');
      eMap[key] = { name: String(l['exercise_name_snapshot']), master_id: mid !== '' ? mid : null, logged_count: 0, volume_kg: 0, max_weight_kg: null, last_date: null };
    }
    const e = eMap[key];
    e.logged_count += 1;
    const k = dateKeyOf_(new Date(l['training_date']));
    if (!e.last_date || k > e.last_date) e.last_date = k;
  });
  tSets.forEach(function (s) {
    const key = logExKey[String(s['training_log_id'])];
    if (!key) return;
    const w = toNumber_(s['weight_kg'], null);
    const reps = toNumber_(s['reps'], 0) || 0;
    if (w !== null && w > 0) {
      eMap[key].volume_kg += w * reps;
      if (eMap[key].max_weight_kg === null || w > eMap[key].max_weight_kg) eMap[key].max_weight_kg = w;
    }
  });
  const exerciseStats = Object.keys(eMap).map(function (k) { return eMap[k]; })
    .sort(function (a, b) { return a.last_date < b.last_date ? 1 : -1; });

  // ---- weight_series（同日はmeasured_at最新を1点） ----
  const wByDate = {};
  bLogs.forEach(function (r) {
    const w = toNumber_(r['weight_kg'], null);
    if (w === null) return;
    const k = dateKeyOf_(new Date(r['measured_at']));
    if (!wByDate[k] || new Date(r['measured_at']) > new Date(wByDate[k].raw)) {
      wByDate[k] = { raw: r['measured_at'], weight_kg: w };
    }
  });
  const weightSeries = Object.keys(wByDate).sort().map(function (k) {
    return { date: k, weight_kg: wByDate[k].weight_kg };
  });

  // ---- bodycomp_series（PROのみ・非NULLフィルタ） ----
  let bodycompSeries = [];
  if (isPremium) {
    bodycompSeries = bLogs
      .filter(function (r) {
        return toNumber_(r['body_fat_pct'], null) !== null || toNumber_(r['skeletal_muscle_kg'], null) !== null;
      })
      .sort(function (a, b) { return new Date(a['measured_at']) - new Date(b['measured_at']); })
      .map(function (r) {
        return {
          date: dateKeyOf_(new Date(r['measured_at'])),
          body_fat_pct: toNumber_(r['body_fat_pct'], null),
          skeletal_muscle_kg: toNumber_(r['skeletal_muscle_kg'], null)
        };
      });
  }

  // ---- intake_daily ----
  const iMap = {};
  mLogs.forEach(function (r) {
    const k = bucketKey(dateKeyOf_(new Date(r['timestamp'])));
    iMap[k] = (iMap[k] || 0) + (Number(r['calories']) || 0);
  });
  const intakeDaily = dailySeries(iMap, function (k) {
    return { date: k, intake_kcal: iMap[k] || 0 };
  });

  return {
    range: { from: from, to: to },
    plan_limits: { range_days: isPremium ? null : 7 },
    weight_series: weightSeries,
    bodycomp_series: bodycompSeries,
    training_daily: trainingDaily,
    training_totals: trainingTotals,
    exercise_stats: exerciseStats,
    intake_daily: intakeDaily,
    notes: {
      volume: 'トレーニングボリュームは重量×回数から算出した参考値です。負荷の高さそのものを示す指標ではありません（例: 60kg×10回×3セットより100kg×5回×3セットの方が高強度な場合があります）。',
      bodyweight: '自重種目は重量を記録しないため、ボリュームには含まれません。回数・セット数は集計されます。',
      bodycomp: '測定した日の値を表示しています。測定していない日の変化は表示していません。体組成の値は測定条件によって変動するため、長期的な傾向を見るための参考値です。',
      exercise: '推定消費カロリーは参考値の合計です。実際の消費カロリーとは異なる場合があります。',
      intake: '摂取と運動消費は相殺されません。'
    }
  };
}