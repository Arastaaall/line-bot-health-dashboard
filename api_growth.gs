// api_growth.gs

// 軽量化: 同一実行内でのGoal_Plans複数回読み込みを防ぐためのインメモリキャッシュ
let __cachedGoalPlans = {};
function getGoalPlansCachedLocally_(userId) {
  if (__cachedGoalPlans[userId]) return __cachedGoalPlans[userId];
  const plans = getGoalPlansCachedLocally_(userId);
  __cachedGoalPlans[userId] = plans;
  return plans;
}
 — Phase 6 成長の記録（読取専用: append/update/deleteは一切不使用）

function apiGetGrowthSummary(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || '7d');
  if (['7d', '30d', '90d', '1y', 'all'].indexOf(range) === -1) range = '7d';
  if (!user.isPremium) range = '7d';

  const tier = user.isPremium ? 'p' : 'f';
  const data = cached_('growth_' + userId + '_' + range + '_' + tier, 120, function () {
    return buildGrowthSummary_(userId, range, user.isPremium);
  });
  return { ok: true, data: data };
}

// 成長画面は同じrangeの4分析をまとめて返し、認証・HTTP往復を1回にする。
// 各分析は既存の個別キャッシュを利用するため、既存actionの契約は変更しない。
function apiGetGrowthAll(userId, params) {
  const range = params && params.range ? params.range : '7d';
  return {
    ok: true,
    data: {
      summary: apiGetGrowthSummary(userId, { range: range }).data,
      training: apiGetTrainingAnalysis(userId, { range: range }).data,
      meal: apiGetMealAnalysis(userId, { range: range }).data,
      body: apiGetBodyAnalysis(userId, { range: range }).data,
      menus: apiGetTrainingMenus(userId, {}).data
    }
  };
}

function buildGrowthSummary_(userId, range, isPremium) {
  const user = getUserRecord_(userId);
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

  // ---- 一括読み込み（読取のみ） ----
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

  // ---- exercise_stats（未登録含む・master_id→名称順・表記ゆれ正規化はv1非実施） ----
  const eMap = {};
  tLogs.forEach(function (l) {
    const key = logExKey[String(l['training_log_id'])];
    if (!eMap[key]) {
      const mid = String(l['master_id'] || '');
      eMap[key] = { name: String(l['exercise_name_snapshot']), master_id: mid !== '' ? mid : null, exercise_logs: 0, volume_kg: 0, max_weight_kg: null, last_date: null, training_type: String(l['training_type']) };    }
    const e = eMap[key];
    e.exercise_logs += 1;
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

  // ---- weight_series（測定点のみ・昇順・同日はmeasured_at最新を1点） ----
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

  // ---- bodycomp_series（PROのみ・非NULLフィルタ・昇順） ----
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

  // ---- 最新体重・BMI（保存しない・都度計算） ----
  const latestWeight = weightSeries.length ? weightSeries[weightSeries.length - 1].weight_kg : null;
  let bmi = null;
  if (latestWeight !== null && user.height !== null && user.height > 0) {
    const hm = user.height / 100;
    bmi = Math.round((latestWeight / (hm * hm)) * 10) / 10;
  }

  // ---- 最新の体組成値（Free/PRO共通・Phase3のdetail定義と同じフィルタ） ----
  const detailRows = bLogs
    .filter(function (r) {
      return toNumber_(r['body_fat_pct'], null) !== null || toNumber_(r['skeletal_muscle_kg'], null) !== null;
    })
    .sort(function (a, b) { return new Date(b['measured_at']) - new Date(a['measured_at']); });
  const latestBodycomp = detailRows.length ? {
    date: dateKeyOf_(new Date(detailRows[0]['measured_at'])),
    body_fat_pct: toNumber_(detailRows[0]['body_fat_pct'], null),
    skeletal_muscle_kg: toNumber_(detailRows[0]['skeletal_muscle_kg'], null),
    muscle_mass_kg: toNumber_(detailRows[0]['muscle_mass_kg'], null),
    visceral_fat: toNumber_(detailRows[0]['visceral_fat'], null),
    bmr: toNumber_(detailRows[0]['bmr'], null),
    waist_cm: toNumber_(detailRows[0]['waist_cm'], null)
  } : null;

  // ---- intake_daily ----
  const iMap = {};
  mLogs.forEach(function (r) {
    const k = bucketKey(dateKeyOf_(new Date(r['timestamp'])));
    iMap[k] = (iMap[k] || 0) + (Number(r['calories']) || 0);
  });
  const intakeDaily = dailySeries(iMap, function (k) {
    return { date: k, intake_kcal: iMap[k] || 0 };
  });

  // ---- goal_period_banner ----
  const goalPlans = getGoalPlansCachedLocally_(userId);
  const activePlan = goalPlans ? goalPlans.active_plan : null;
  let goalBanner = { show: false, message: '' };
  if (activePlan && activePlan.planned_end_date) {
    const endStr = String(activePlan.planned_end_date).slice(0, 10);
    if (endStr && to > endStr) {
      goalBanner = {
        show: true,
        message: '目標期間が終了しています。現在の体重・体組成を確認し、必要に応じて目標を更新してください。'
      };
    }
  }

  return {
    range: { from: from, to: to },
    plan_limits: { range_days: isPremium ? null : 7 },
    latest_weight_kg: latestWeight,
    bmi: bmi,
    latest_bodycomp: latestBodycomp,
    weight_series: weightSeries,
    bodycomp_series: bodycompSeries,
    training_daily: trainingDaily,
    training_totals: trainingTotals,
    exercise_stats: exerciseStats,
    intake_daily: intakeDaily,
    goal_period_banner: goalBanner,
    notes: {
      volume: 'トレーニングボリュームは重量×回数から算出した参考値です。負荷の高さそのものを示す指標ではありません（例: 60kg×10回×3セットより100kg×5回×3セットの方が高強度な場合があります）。',
      bodyweight: '自重種目は重量を記録しないため、ボリュームには含まれません。回数・セット数は集計されます。',
      bodycomp: '測定した日の値を表示しています。測定していない日の変化は表示していません。体組成の値は測定条件によって変動するため、長期的な傾向を見るための参考値です。',
      exercise: '推定消費カロリーは参考値の合計です。実際の消費カロリーとは異なる場合があります。',
      intake: '摂取と運動消費は相殺されません。',
      disclaimer: '目標達成度および表示は現在設定されている目標プランに基づく参考値です。'
    }
  };
}

// ===== Phase 6 拡張分析 バッチ1（トレーニング系・read-only） =====
// 列名確定: 推定消費カロリー = estimated_calories

const G_ANIMAL_LADDER = [
  { kg: 1000, label: '🚗 1t' }, { kg: 5000, label: '🐘 5t' }, { kg: 8000, label: '🦣 8t' },
  { kg: 30000, label: '🐋 30t' }, { kg: 100000, label: '🐳 100t' }
];
const G_DIST_LADDER = [
  { km: 10, label: '10km' }, { km: 21.1, label: '21.1km（ハーフマラソン）' },
  { km: 30, label: '30km（東京→さいたま相当）' }, { km: 34.5, label: '34.5km（山手線1周相当）' },
  { km: 42.195, label: '42.195km（フルマラソン）' }, { km: 100, label: '100km' }
];

function gBounds_(range) {
  const to = todayKey_();
  let from = null;
  if (range === '7d') { const d = new Date(); d.setDate(d.getDate() - 6); from = dateKeyOf_(d); }
  else if (range === '30d') { const d = new Date(); d.setDate(d.getDate() - 29); from = dateKeyOf_(d); }
  else if (range === '90d') { const d = new Date(); d.setDate(d.getDate() - 89); from = dateKeyOf_(d); }
  else if (range === '1y') { const d = new Date(); d.setDate(d.getDate() - 364); from = dateKeyOf_(d); }
  return { from: from, to: to };
}
function gIn_(k, b) { return (!b.from || k >= b.from) && k <= b.to; }
function gWeekly_(range) { return range === '1y' || range === 'all'; }
function gBucket_(k, weekly) {
  if (!weekly) return k;
  const d = new Date(k + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return dateKeyOf_(d);
}
function gKey_(l) {
  const mid = String(l['master_id'] || '');
  return mid !== '' ? mid : String(l['exercise_name_snapshot']);
}
function gKeyName_(key) {
  const m = findById('Training_Master', 'master_id', key);
  return m ? String(m['exercise_name']) : key;
}
function gBodyPart_(key) {
  const m = findById('Training_Master', 'master_id', key);
  return m ? String(m['body_part'] || 'other') : null;
}
function masterIdOrNull_(key) {
  return findById('Training_Master', 'master_id', key) ? key : null;
}
function gHistoricalWeight_(bLogs, dateKey) {
  let bestK = null, bestW = null, bestC = null;
  bLogs.forEach(function (r) {
    const w = toNumber_(r['weight_kg'], null);
    if (w === null) return;
    const k = dateKeyOf_(new Date(r['measured_at']));
    if (k > dateKey) return; // 未来の測定値は使わない
    const c = String(r['created_at']);
    if (bestK === null || k > bestK || (k === bestK && c > bestC)) { bestK = k; bestW = w; bestC = c; }
  });
  return bestW;
}
function gSetsByLog_(tSets) {
  const m = {};
  tSets.forEach(function (s) {
    const id = String(s['training_log_id']);
    (m[id] = m[id] || []).push(s);
  });
  return m;
}
function gCardioType_(name) {
  const n = String(name);
  if (n.indexOf('ラン') !== -1 || /run/i.test(n)) return 'running';
  if (n.indexOf('ウォーク') !== -1 || n.indexOf('散歩') !== -1 || /walk/i.test(n)) return 'walking';
  if (n.indexOf('サイクリ') !== -1 || n.indexOf('バイク') !== -1 || /cycl/i.test(n)) return 'cycling';
  return 'other';
}
function gVolumeOfSets_(sets) {
  let v = 0;
  (sets || []).forEach(function (s) {
    const w = toNumber_(s['weight_kg'], null);
    const reps = toNumber_(s['reps'], 0) || 0;
    if (w !== null && w > 0) v += w * reps; // 自重・weight<=0は加算しない
  });
  return v;
}

// 加重セットを持つ種目の上位N件（ログ数順・同数は直近優先）
function gTopWeightedKeys_(userId, n) {
  const logs = getRows('Training_Logs', function (r) { return String(r['user_id']) === String(userId); });
  const ids = {};
  logs.forEach(function (l) { ids[String(l['training_log_id'])] = true; });
  const weighted = {};
  getRows('Training_Sets', function (s) { return !!ids[String(s['training_log_id'])]; }).forEach(function (s) {
    const w = toNumber_(s['weight_kg'], null);
    if (w !== null && w > 0) weighted[String(s['training_log_id'])] = true;
  });
  const count = {}, last = {};
  logs.forEach(function (l) {
    if (!weighted[String(l['training_log_id'])]) return;
    const k = gKey_(l);
    count[k] = (count[k] || 0) + 1;
    const d = dateKeyOf_(new Date(l['training_date']));
    if (!last[k] || d > last[k]) last[k] = d;
  });
  return Object.keys(count).map(function (k) { return { key: k, count: count[k], last: last[k] }; })
    .sort(function (a, b) { return b.count - a.count || (a.last < b.last ? 1 : -1); })
    .slice(0, n);
}

function gRepresentativeKey_(userId) {
  const top = gTopWeightedKeys_(userId, 1);
  return top.length ? top[0].key : null;
}

// 共有関数: PR/伸び率/1RM（T4/T5/T6 と 軌跡ヘッダーで共用）
function calculateExercisePrGrowth1rm_(userId, exerciseKey, range) {
  const logs = getRows('Training_Logs', function (r) {
    return String(r['user_id']) === String(userId) && gKey_(r) === exerciseKey;
  }).sort(function (a, b) { return new Date(a['training_date']) - new Date(b['training_date']); });
  if (!logs.length) return null;
  const ids = {};
  logs.forEach(function (l) { ids[String(l['training_log_id'])] = true; });
  const setsByLog = gSetsByLog_(getRows('Training_Sets', function (s) { return !!ids[String(s['training_log_id'])]; }));

  const b = gBounds_(range || 'all');
  let prWeight = null, prDate = null, initialWeight = null, initialDone = false, maxBefore = null;
  const epley = {};
  logs.forEach(function (l) {
    const k = dateKeyOf_(new Date(l['training_date']));
    const ls = setsByLog[String(l['training_log_id'])] || [];
    let logMax = null;
    ls.forEach(function (s) {
      const w = toNumber_(s['weight_kg'], null);
      if (w === null || w <= 0) return;
      if (!initialDone) logMax = (logMax === null || w > logMax) ? w : logMax;
      if (prWeight === null || w > prWeight) { prWeight = w; prDate = k; }
      if (b.from && k < b.from) { if (maxBefore === null || w > maxBefore) maxBefore = w; }
      const reps = toNumber_(s['reps'], 0) || 0;
      if (reps >= 1 && reps <= 12) { // 1RMはreps≤12のみ
        const e = Math.round(w * (1 + reps / 30) * 10) / 10;
        if (!epley[k] || e > epley[k]) epley[k] = e;
      }
    });
    if (!initialDone && logMax !== null) { initialWeight = logMax; initialDone = true; }
  });
  const inRange = prDate !== null && gIn_(prDate, b);
  return {
    exercise_key: exerciseKey,
    exercise_name: gKeyName_(exerciseKey),
    pr_weight: prWeight,
    pr_date: prDate,
    is_new_pr_in_range: inRange && (maxBefore === null || prWeight > maxBefore),
    initial_weight: initialWeight,
    growth_percent: (prWeight !== null && initialWeight) ? Math.round((prWeight - initialWeight) / initialWeight * 1000) / 10 : null,
    epley_series: Object.keys(epley).sort().map(function (k) { return { date: k, value: epley[k] }; })
  };
}

function apiGetTrainingAnalysis(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || '7d');
  if (['7d', '30d', '90d', '1y', 'all'].indexOf(range) === -1) range = '7d';
  if (!user.isPremium) range = '7d';
  const tier = user.isPremium ? 'p' : 'f';
  const data = cached_('growth_training_' + userId + '_' + range + '_' + tier, 120, function () {
    return buildTrainingAnalysis_(userId, range);
  });
  return { ok: true, data: data };
}

function buildTrainingAnalysis_(userId, range) {
  const b = gBounds_(range);
  const tLogsAll = getRows('Training_Logs', function (r) { return String(r['user_id']) === String(userId); });
  const idsAll = {};
  tLogsAll.forEach(function (l) { idsAll[String(l['training_log_id'])] = true; });
  const setsByLog = gSetsByLog_(getRows('Training_Sets', function (s) { return !!idsAll[String(s['training_log_id'])]; }));
  const bLogs = getRows('Body_Composition', function (r) { return String(r['user_id']) === String(userId); });
  const mLogs = getRows('logs', function (r) { return String(r['user_id']) === String(userId); });
  const tLogs = tLogsAll.filter(function (l) { return gIn_(dateKeyOf_(new Date(l['training_date'])), b); });

  const blocks = {};
  function ready(k, d) { blocks[k] = { status: 'ready', data: d }; }
  function insuff(k) { blocks[k] = { status: 'insufficient', message: 'まだデータが足りません' }; }
  function empty(k) { blocks[k] = { status: 'empty', message: 'まだデータが足りません' }; }

  // T1 部位別
  (function () {
    const strength = tLogs.filter(function (l) { return String(l['training_type']) !== 'cardio'; });
    if (!strength.length) { empty('T1'); return; }
    const agg = {};
    strength.forEach(function (l) {
      const part = gBodyPart_(gKey_(l)) || '未登録';
      if (!agg[part]) agg[part] = { body_part: part, volume_kg: 0, exercise_logs: 0 };
      agg[part].exercise_logs += 1;
      agg[part].volume_kg += gVolumeOfSets_(setsByLog[String(l['training_log_id'])]);
    });
    ready('T1', Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, z) { return z.volume_kg - a.volume_kg; }));
  })();

  // T2 距離別＋直近リスト
  (function () {
    const cardio = tLogs.filter(function (l) { return String(l['training_type']) === 'cardio'; });
    if (!cardio.some(function (l) { return toNumber_(l['distance_km'], null) !== null; })) { empty('T2'); return; }
    const agg = {};
    cardio.forEach(function (l) {
      const t = gCardioType_(l['exercise_name_snapshot']);
      if (!agg[t]) agg[t] = { type: t, distance_km: 0, count: 0, duration_min: 0, recent: [] };
      const d = toNumber_(l['distance_km'], null);
      const dur = toNumber_(l['duration_min'], 0) || 0;
      if (d !== null) agg[t].distance_km += d;
      agg[t].count += 1;
      agg[t].duration_min += dur;
      agg[t].recent.push({ date: dateKeyOf_(new Date(l['training_date'])), distance_km: d, duration_min: dur });
    });
    ready('T2', Object.keys(agg).map(function (k) {
      const a = agg[k];
      a.recent.sort(function (x, y) { return x.date < y.date ? 1 : -1; });
      return {
        type: a.type,
        distance_km: Math.round(a.distance_km * 100) / 100,
        count: a.count,
        duration_min: a.duration_min,
        avg_pace: (a.distance_km > 0 && a.duration_min > 0) ? Math.round(a.duration_min / a.distance_km * 100) / 100 : null,
        recent: a.recent.slice(0, 5).map(function (r) {
          return { date: r.date, distance_km: r.distance_km, duration_min: r.duration_min,
            pace: (r.distance_km && r.duration_min) ? Math.round(r.duration_min / r.distance_km * 100) / 100 : null };
        })
      };
    }));
  })();

  // T4/T5/T6 代表種目
  (function () {
    const repKey = gRepresentativeKey_(userId);
    if (!repKey) { insuff('T4'); insuff('T5'); insuff('T6'); return; }
    const calc = calculateExercisePrGrowth1rm_(userId, repKey, range);
    if (!calc || calc.pr_weight === null) { insuff('T4'); insuff('T5'); insuff('T6'); return; }
    ready('T4', { name: calc.exercise_name, pr_weight: calc.pr_weight, pr_date: calc.pr_date, is_new_pr_in_range: calc.is_new_pr_in_range });
    if (calc.growth_percent === null) insuff('T5');
    else ready('T5', { name: calc.exercise_name, initial_weight: calc.initial_weight, pr_weight: calc.pr_weight, growth_percent: calc.growth_percent });
    const multi = gTopWeightedKeys_(userId, 3).map(function (t) {
      const c = calculateExercisePrGrowth1rm_(userId, t.key, range);
      return c && c.epley_series.length >= 2 ? { name: c.exercise_name, series: c.epley_series } : null;
    }).filter(function (x) { return x !== null; });
    if (multi.length) ready('T6', multi);
    else insuff('T6');
  })();

  // T7 週次ボリューム＋体重
  (function () {
    const weeks = {};
    tLogs.forEach(function (l) {
      if (String(l['training_type']) === 'cardio') return;
      const wk = gBucket_(dateKeyOf_(new Date(l['training_date'])), true);
      if (!weeks[wk]) weeks[wk] = 0;
      weeks[wk] += gVolumeOfSets_(setsByLog[String(l['training_log_id'])]);
    });
    const wks = Object.keys(weeks).sort();
    if (!wks.length) { empty('T7'); return; }
    const volume_series = wks.map(function (wk, i) {
      const prev = i > 0 ? weeks[wks[i - 1]] : null;
      return { date: wk, volume_kg: weeks[wk],
        wow_percent: (prev && prev > 0) ? Math.round((weeks[wk] - prev) / prev * 1000) / 10 : null };
    });
    const wbw = {};
    bLogs.forEach(function (r) {
      const w = toNumber_(r['weight_kg'], null);
      if (w === null) return;
      const wk = gBucket_(dateKeyOf_(new Date(r['measured_at'])), true);
      if (!wbw[wk] || new Date(r['measured_at']) > new Date(wbw[wk].raw)) wbw[wk] = { raw: r['measured_at'], w: w };
    });
    ready('T7', { volume_series: volume_series,
      weight_series: Object.keys(wbw).sort().map(function (wk) { return { date: wk, weight_kg: wbw[wk].w }; }) });
  })();

  // T8 時間+kcal（cardio日別・保存値使用）
  (function () {
    const days = {};
    tLogs.forEach(function (l) {
      if (String(l['training_type']) !== 'cardio') return;
      const dur = toNumber_(l['duration_min'], 0) || 0;
      if (dur <= 0) return;
      const k = dateKeyOf_(new Date(l['training_date']));
      if (!days[k]) days[k] = { duration_min: 0, estimated_kcal: 0 };
      days[k].duration_min += dur;
      days[k].estimated_kcal += toNumber_(l['estimated_calories'], 0) || 0;
    });
    const ks = Object.keys(days).sort();
    if (!ks.length) { empty('T8'); return; }
    ready('T8', ks.map(function (k) { return { date: k, duration_min: days[k].duration_min, estimated_kcal: days[k].estimated_kcal }; }));
  })();

  // T9 密度
  (function () {
    let vol = 0, dur = 0;
    const daily = {};
    tLogs.forEach(function (l) {
      if (String(l['training_type']) === 'cardio') return;
      const d = toNumber_(l['duration_min'], 0) || 0;
      if (d <= 0) return;
      const v = gVolumeOfSets_(setsByLog[String(l['training_log_id'])]);
      vol += v; dur += d;
      const k = dateKeyOf_(new Date(l['training_date']));
      if (!daily[k]) daily[k] = { v: 0, d: 0 };
      daily[k].v += v; daily[k].d += d;
    });
    if (dur <= 0) { insuff('T9'); return; }
    let best = null;
    Object.keys(daily).forEach(function (k) {
      const rate = daily[k].d > 0 ? daily[k].v / daily[k].d : 0;
      if (!best || rate > best.rate) best = { date: k, rate: Math.round(rate * 10) / 10 };
    });
    ready('T9', { density_kg_per_min: Math.round(vol / dur * 10) / 10, best_day: best });
  })();

  // T10 動物マイルストーン（全期間）
  (function () {
    let total = 0;
    tLogsAll.forEach(function (l) {
      if (String(l['training_type']) === 'cardio') return;
      total += gVolumeOfSets_(setsByLog[String(l['training_log_id'])]);
    });
    if (total <= 0) { empty('T10'); return; }
    let achieved = null, next = null;
    G_ANIMAL_LADDER.forEach(function (st) {
      if (total >= st.kg) achieved = st.label;
      if (!next && total < st.kg) next = st.label;
    });
    ready('T10', { total_kg: total, total_t: Math.round(total / 100) / 10, achieved: achieved, next: next });
  })();

  // T11 距離マイルストーン（全期間・ラン+ウォーク）
  (function () {
    let total = 0;
    tLogsAll.forEach(function (l) {
      if (String(l['training_type']) !== 'cardio') return;
      if (gCardioType_(l['exercise_name_snapshot']) === 'cycling') return;
      const d = toNumber_(l['distance_km'], null);
      if (d !== null) total += d;
    });
    if (total <= 0) { empty('T11'); return; }
    let achieved = null, next = null;
    G_DIST_LADDER.forEach(function (st) {
      if (total >= st.km) achieved = st.label;
      if (!next && total < st.km) next = st.label;
    });
    ready('T11', { total_km: Math.round(total * 100) / 100, achieved: achieved, next: next });
  })();

  // T12 週ストリーク
  (function () {
    const days = {};
    tLogsAll.forEach(function (l) { days[dateKeyOf_(new Date(l['training_date']))] = true; });
    const weekSet = {};
    Object.keys(days).forEach(function (k) { weekSet[gBucket_(k, true)] = true; });
    if (!Object.keys(weekSet).length) { empty('T12'); return; }
    const thisWeek = gBucket_(todayKey_(), true);
    let current = 0;
    if (weekSet[thisWeek]) {
      let p = thisWeek;
      while (weekSet[p]) { current += 1; const d = new Date(p + 'T00:00:00'); d.setDate(d.getDate() - 7); p = dateKeyOf_(d); }
    }
    let longest = 0;
    Object.keys(weekSet).forEach(function (wk) {
      const d = new Date(wk + 'T00:00:00'); d.setDate(d.getDate() - 7);
      if (weekSet[dateKeyOf_(d)]) return;
      let len = 0, q = wk;
      while (weekSet[q]) { len += 1; const dd = new Date(q + 'T00:00:00'); dd.setDate(dd.getDate() + 7); q = dateKeyOf_(dd); }
      if (len > longest) longest = len;
    });
    ready('T12', { current_weeks: current, longest_weeks: longest });
  })();

  // T13 月間日数（直近6暦月）
  (function () {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }
    const counts = {};
    months.forEach(function (m) { counts[m] = {}; });
    tLogsAll.forEach(function (l) {
      const k = dateKeyOf_(new Date(l['training_date']));
      const m = k.slice(0, 7);
      if (counts[m]) counts[m][k] = true;
    });
    if (!months.some(function (m) { return Object.keys(counts[m]).length > 0; })) { empty('T13'); return; }
    ready('T13', months.map(function (m) {
      return { month: m, days: Object.keys(counts[m]).length, in_progress: m === months[5] };
    }));
  })();

  // T14 メモタイムライン
  (function () {
    const list = tLogsAll.filter(function (l) { return String(l['memo'] || '').trim() !== ''; })
      .sort(function (a, z) { return new Date(z['training_date']) - new Date(a['training_date']); })
      .slice(0, 10)
      .map(function (l) {
        return { date: dateKeyOf_(new Date(l['training_date'])), name: String(l['exercise_name_snapshot']), memo: String(l['memo']).replace(/\n/g, ' ') };
      });
    if (!list.length) { empty('T14'); return; }
    ready('T14', list);
  })();

  // T15 平均RPE（週次・set.rpe優先）
  (function () {
    const sum = {}, cnt = {};
    tLogsAll.forEach(function (l) {
      const wk = gBucket_(dateKeyOf_(new Date(l['training_date'])), true);
      const ls = setsByLog[String(l['training_log_id'])] || [];
      let vals = [];
      ls.forEach(function (s) { const r = toNumber_(s['rpe'], null); if (r !== null) vals.push(r); });
      if (!vals.length) { const lr = toNumber_(l['rpe'], null); if (lr !== null) vals.push(lr); }
      vals.forEach(function (v) { sum[wk] = (sum[wk] || 0) + v; cnt[wk] = (cnt[wk] || 0) + 1; });
    });
    const weeks = Object.keys(cnt);
    const total = weeks.reduce(function (s, w) { return s + cnt[w]; }, 0);
    if (total < 3 || weeks.length < 2) { insuff('T15'); return; }
    ready('T15', weeks.sort().map(function (wk) { return { date: wk, avg_rpe: Math.round(sum[wk] / cnt[wk] * 10) / 10 }; }));
  })();

  // T16 RPE乖離（同種目+同重量・+2以上・最大10）
  (function () {
    const byKey = {};
    tLogsAll.forEach(function (l) {
      const ls = setsByLog[String(l['training_log_id'])] || [];
      let wMax = null; const rpes = [];
      ls.forEach(function (s) {
        const w = toNumber_(s['weight_kg'], null);
        if (w !== null && w > 0) wMax = (wMax === null || w > wMax) ? w : wMax;
        const r = toNumber_(s['rpe'], null);
        if (r !== null) rpes.push(r);
      });
      if (!rpes.length) { const lr = toNumber_(l['rpe'], null); if (lr !== null) rpes.push(lr); }
      if (wMax === null || !rpes.length) return;
      (byKey[gKey_(l)] = byKey[gKey_(l)] || []).push({
        date: dateKeyOf_(new Date(l['training_date'])), weight: wMax,
        avg: rpes.reduce(function (a, x) { return a + x; }, 0) / rpes.length
      });
    });
    const out = [];
    Object.keys(byKey).forEach(function (key) {
      const arr = byKey[key].sort(function (a, z) { return a.date < z.date ? -1 : 1; });
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].weight === arr[i - 1].weight) {
          const delta = Math.round((arr[i].avg - arr[i - 1].avg) * 10) / 10;
          if (delta >= 2) out.push({ name: gKeyName_(key), weight: arr[i].weight,
            prev_rpe: Math.round(arr[i - 1].avg * 10) / 10, curr_rpe: Math.round(arr[i].avg * 10) / 10,
            delta: delta, date: arr[i].date });
        }
      }
    });
    if (!out.length) { empty('T16'); return; }
    out.sort(function (a, z) { return a.date < z.date ? 1 : -1; });
    ready('T16', out.slice(0, 10));
  })();

  // T17 相対筋力（代表種目・historical_weight使用）
  (function () {
    const repKey = gRepresentativeKey_(userId);
    if (!repKey) { insuff('T17'); return; }
    const pts = [];
    tLogsAll.forEach(function (l) {
      if (gKey_(l) !== repKey) return;
      let wMax = null;
      (setsByLog[String(l['training_log_id'])] || []).forEach(function (s) {
        const w = toNumber_(s['weight_kg'], null);
        if (w !== null && w > 0) wMax = (wMax === null || w > wMax) ? w : wMax;
      });
      if (wMax === null) return;
      const k = dateKeyOf_(new Date(l['training_date']));
      const hw = gHistoricalWeight_(bLogs, k);
      if (hw === null || hw <= 0) return;
      pts.push({ date: k, value: Math.round(wMax / hw * 100) / 100 });
    });
    pts.sort(function (a, z) { return a.date < z.date ? -1 : 1; });
    if (pts.length < 2) { insuff('T17'); return; }
    ready('T17', { name: gKeyName_(repKey), series: pts });
  })();

  // D1 今日のひとこと（決定論的テンプレート）
  (function () {
    const t = todayKey_();
    const todayTr = tLogsAll.filter(function (l) { return dateKeyOf_(new Date(l['training_date'])) === t; })
      .sort(function (a, z) { return String(z['created_at']).localeCompare(String(a['created_at'])); });
    if (todayTr.length) {
      const l = todayTr[0];
      const ls = setsByLog[String(l['training_log_id'])] || [];
      let txt = String(l['exercise_name_snapshot']) + 'を記録';
      if (ls.length) {
        const s = ls[0];
        const w = toNumber_(s['weight_kg'], null);
        txt = String(l['exercise_name_snapshot']) + ' ' + (toBool_(s['is_bodyweight']) ? '自重' : (w !== null ? w + 'kg' : '')) + '×' + (toNumber_(s['reps'], 0) || 0) + 'を記録';
      } else if (toNumber_(l['duration_min'], 0)) {
        txt = String(l['exercise_name_snapshot']) + ' ' + toNumber_(l['duration_min'], 0) + '分を記録';
      }
      ready('D1', { text: txt });
      return;
    }
    const todayMeal = mLogs.filter(function (r) { return dateKeyOf_(new Date(r['timestamp'])) === t; });
    if (todayMeal.length) { ready('D1', { text: String(todayMeal[todayMeal.length - 1]['menu_name'] || '食事') + 'を記録' }); return; }
    empty('D1');
  })();

  // D2 今週トレ日数
  (function () {
    const thisWeek = gBucket_(todayKey_(), true);
    const days = {};
    tLogsAll.forEach(function (l) {
      const k = dateKeyOf_(new Date(l['training_date']));
      if (gBucket_(k, true) === thisWeek) days[k] = true;
    });
    ready('D2', { days: Object.keys(days).length, reference_goal: 3 });
  })();

  // R2 通常間隔プロンプト
  (function () {
    const days = {};
    tLogsAll.forEach(function (l) { days[dateKeyOf_(new Date(l['training_date']))] = true; });
    const ds = Object.keys(days).sort();
    if (ds.length < 6 || ds[ds.length - 1] === todayKey_()) { empty('R2'); return; }
    let sum = 0;
    for (let i = ds.length - 5; i < ds.length; i++) {
      sum += (new Date(ds[i] + 'T00:00:00').getTime() - new Date(ds[i - 1] + 'T00:00:00').getTime()) / 86400000;
    }
    const avg = sum / 5;
    const current = (new Date(todayKey_() + 'T00:00:00').getTime() - new Date(ds[ds.length - 1] + 'T00:00:00').getTime()) / 86400000;
    if (current > avg * 1.5) ready('R2', { average_interval: Math.round(avg * 10) / 10, current_interval: current });
    else empty('R2');
  })();

  // O1 月次レキャップ
  (function () {
    const nowM = todayKey_().slice(0, 7);
    const days = {};
    let vol = 0;
    tLogsAll.forEach(function (l) {
      if (dateKeyOf_(new Date(l['training_date'])).slice(0, 7) !== nowM) return;
      days[dateKeyOf_(new Date(l['training_date']))] = true;
      if (String(l['training_type']) !== 'cardio') vol += gVolumeOfSets_(setsByLog[String(l['training_log_id'])]);
    });
    const wVals = bLogs.filter(function (r) { return dateKeyOf_(new Date(r['measured_at'])).slice(0, 7) === nowM; })
      .sort(function (a, z) { return new Date(a['measured_at']) - new Date(z['measured_at']); })
      .map(function (r) { return toNumber_(r['weight_kg'], null); })
      .filter(function (w) { return w !== null; });
    const weightChange = wVals.length >= 2 ? Math.round((wVals[wVals.length - 1] - wVals[0]) * 10) / 10 : null;
    const byDay = {};
    mLogs.forEach(function (r) {
      const k = dateKeyOf_(new Date(r['timestamp']));
      if (k.slice(0, 7) !== nowM) return;
      byDay[k] = (byDay[k] || 0) + (Number(r['calories']) || 0);
    });
    const dv = Object.keys(byDay).map(function (k) { return byDay[k]; });
    const avgIntake = dv.length ? Math.round(dv.reduce(function (a, x) { return a + x; }, 0) / dv.length) : null;
    const daysCount = Object.keys(days).length;
    if (!daysCount && avgIntake === null && weightChange === null) { empty('O1'); return; }
    ready('O1', { month: nowM, training_days: daysCount, volume_kg: vol,
      elephant: vol > 0 ? Math.round(vol / 5000 * 100) / 100 : null,
      weight_change: weightChange, avg_intake: avgIntake, in_progress: true });
  })();

  return { range: range, blocks: blocks };
}

// ---------- 種目軌跡 ----------
function apiGetMenuTrajectory(userId, params) {
  const masterId = String(params.master_id || '');
  const name = String(params.exercise_name_snapshot || '');
  const key = masterId !== '' ? masterId : name;
  if (key === '') return { ok: false, error: { code: 'VALIDATION_ERROR', message: '種目が指定されていません' } };
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key).map(function (bt) {
    return ('0' + (bt + 256) % 256).toString(16).slice(-2);
  }).join('');
  const data = cached_('growth_trajectory_' + userId + '_' + hash, 120, function () {
    return buildTrajectory_(userId, key);
  });
  return { ok: true, data: data };
}

function buildTrajectory_(userId, key) {
  const logs = getRows('Training_Logs', function (r) {
    return String(r['user_id']) === String(userId) && gKey_(r) === key;
  }).sort(function (a, b) { return new Date(a['training_date']) - new Date(b['training_date']); });
  const base = { exercise: { master_id: masterIdOrNull_(key), exercise_name: gKeyName_(key) } };
  if (!logs.length) return { exercise: base.exercise, sessions: [], header: null };
  const ids = {};
  logs.forEach(function (l) { ids[String(l['training_log_id'])] = true; });
  const setsByLog = gSetsByLog_(getRows('Training_Sets', function (s) { return !!ids[String(s['training_log_id'])]; }));

  // 最新6セッション・日付昇順・セット上限6
  const sessions = logs.slice(-6).map(function (l) {
    return {
      date: dateKeyOf_(new Date(l['training_date'])),
      duration_min: toNumber_(l['duration_min'], null),
      distance_km: toNumber_(l['distance_km'], null),
      sets: (setsByLog[String(l['training_log_id'])] || [])
        .sort(function (a, b) { return (Number(a['set_no']) || 0) - (Number(b['set_no']) || 0); })
        .slice(0, 6)
        .map(function (s) {
          const w = toNumber_(s['weight_kg'], null);
          const bw = toBool_(s['is_bodyweight']);
          const reps = toNumber_(s['reps'], 0) || 0;
          return {
            set_no: Number(s['set_no']) || 0,
            weight_kg: w,
            reps: reps,
            is_bodyweight: bw,
            display: bw ? '自重 × ' + reps : (w !== null ? w + 'kg × ' + reps : '× ' + reps),
            weight_up: false
          };
        })
    };
  });
  // weight_up: 同set番号で前回より重量増かつ自重でない場合のみ
  for (let i = 1; i < sessions.length; i++) {
    sessions[i].sets.forEach(function (st) {
      if (st.is_bodyweight) { st.weight_up = false; return; }
      const prev = sessions[i - 1].sets.filter(function (p) { return p.set_no === st.set_no; })[0];
      if (prev && !prev.is_bodyweight && st.weight_kg !== null && prev.weight_kg !== null && st.weight_kg > prev.weight_kg) st.weight_up = true;
    });
  }
  return { exercise: base.exercise, sessions: sessions, header: calculateExercisePrGrowth1rm_(userId, key, 'all') };
}

// ===== Phase 6 拡張分析 バッチ2（食事・体組成系・read-only） =====

function gLinRegSlope_(pts) {
  const n = pts.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  pts.forEach(function (p) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  return (n * sxy - sx * sy) / denom;
}

function apiGetMealAnalysis(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || '7d');
  if (['7d', '30d', '90d', '1y', 'all'].indexOf(range) === -1) range = '7d';
  if (!user.isPremium) range = '7d';
  const tier = user.isPremium ? 'p' : 'f';
  const data = cached_('growth_meal_' + userId + '_' + range + '_' + tier, 120, function () {
    return buildMealAnalysis_(userId, range);
  });
  return { ok: true, data: data };
}

function buildMealAnalysis_(userId, range) {
  const b = gBounds_(range);
  const mLogs = getRows('logs', function (r) { return String(r['user_id']) === String(userId); });
  const tLogsAll = getRows('Training_Logs', function (r) { return String(r['user_id']) === String(userId); });
  const bLogs = getRows('Body_Composition', function (r) { return String(r['user_id']) === String(userId); });

  const trainDays = {};
  tLogsAll.forEach(function (l) { trainDays[dateKeyOf_(new Date(l['training_date']))] = true; });

  const byDay = {};
  mLogs.forEach(function (r) {
    const k = dateKeyOf_(new Date(r['timestamp']));
    if (!gIn_(k, b)) return;
    if (!byDay[k]) byDay[k] = { kcal: 0, protein: 0, ge20: 0 };
    byDay[k].kcal += Number(r['calories']) || 0;
    byDay[k].protein += Number(r['protein']) || 0;
    if ((Number(r['protein']) || 0) >= 20) byDay[k].ge20 += 1;
  });
  const dayKeys = Object.keys(byDay).sort();

  const blocks = {};
  function ready(k, d) { blocks[k] = { status: 'ready', data: d }; }
  function insuff(k) { blocks[k] = { status: 'insufficient', message: 'まだデータが足りません' }; }
  function empty(k) { blocks[k] = { status: 'empty', message: 'まだデータが足りません' }; }

  // M0 トレ日vs休息日
  (function () {
    const tr = { kcal: [], p: [] }, re = { kcal: [], p: [] };
    dayKeys.forEach(function (k) {
      const g = trainDays[k] ? tr : re;
      g.kcal.push(byDay[k].kcal);
      g.p.push(byDay[k].protein);
    });
    if (tr.kcal.length < 3 || re.kcal.length < 3) { insuff('M0'); return; }
    const avg = function (a) { return Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length); };
    ready('M0', {
      training_days: { days: tr.kcal.length, avg_kcal: avg(tr.kcal), avg_protein: avg(tr.p) },
      rest_days: { days: re.kcal.length, avg_kcal: avg(re.kcal), avg_protein: avg(re.p) }
    });
  })();

  // M3 時間帯分布
  (function () {
    const c = { morning: 0, noon: 0, evening: 0, night: 0 };
    let any = false;
    mLogs.forEach(function (r) {
      const k = dateKeyOf_(new Date(r['timestamp']));
      if (!gIn_(k, b)) return;
      any = true;
      const h = new Date(r['timestamp']).getHours();
      if (h >= 5 && h <= 9) c.morning += 1;
      else if (h >= 10 && h <= 16) c.noon += 1;
      else if (h >= 17 && h <= 20) c.evening += 1;
      else c.night += 1;
    });
    if (!any) { empty('M3'); return; }
    ready('M3', c);
  })();

  // M4 摂取安定度（母集団SD）
  (function () {
    if (dayKeys.length < 3) { insuff('M4'); return; }
    const vals = dayKeys.map(function (k) { return byDay[k].kcal; });
    const mean = vals.reduce(function (a, x) { return a + x; }, 0) / vals.length;
    const sd = Math.round(Math.sqrt(vals.reduce(function (a, x) { return a + (x - mean) * (x - mean); }, 0) / vals.length));
    ready('M4', { sd_kcal: sd, label: sd < 200 ? '安定' : (sd < 400 ? '普通' : '変動大きめ') });
  })();

  // M6 タンパクg/kg（historical_weight・未来値不使用）
  (function () {
    const series = [];
    dayKeys.forEach(function (k) {
      const hw = gHistoricalWeight_(bLogs, k);
      if (hw === null || hw <= 0) return;
      series.push({ date: k, value: Math.round(byDay[k].protein / hw * 100) / 100 });
    });
    if (series.length < 3) { insuff('M6'); return; }
    ready('M6', series);
  })();

  // M7 タンパク20g↑（畳みリスト用recent付き）
  (function () {
    if (!dayKeys.length) { empty('M7'); return; }
    const totalGe = dayKeys.reduce(function (s, k) { return s + byDay[k].ge20; }, 0);
    const recent = mLogs
      .filter(function (r) { return (Number(r['protein']) || 0) >= 20 && gIn_(dateKeyOf_(new Date(r['timestamp'])), b); })
      .sort(function (a, z) { return String(z['timestamp']).localeCompare(String(a['timestamp'])); })
      .slice(0, 10)
      .map(function (r) {
        return { date: dateKeyOf_(new Date(r['timestamp'])), menu_name: String(r['menu_name'] || '').slice(0, 12), protein: Number(r['protein']) || 0 };
      });
    ready('M7', { avg_per_day: Math.round(totalGe / dayKeys.length * 100) / 100, recent: recent });
  })();

  // M10 長距離日比較（ラン+ウォーク合計≥10km）
  (function () {
    const distByDay = {};
    tLogsAll.forEach(function (l) {
      if (String(l['training_type']) !== 'cardio') return;
      if (gCardioType_(l['exercise_name_snapshot']) === 'cycling') return;
      const d = toNumber_(l['distance_km'], null);
      if (d === null) return;
      const k = dateKeyOf_(new Date(l['training_date']));
      distByDay[k] = (distByDay[k] || 0) + d;
    });
    const L = [], O = [];
    dayKeys.forEach(function (k) { ((distByDay[k] || 0) >= 10 ? L : O).push(k); });
    if (L.length < 3 || O.length < 3) { insuff('M10'); return; }
    const avgOf = function (ks) { return Math.round(ks.reduce(function (s, k) { return s + byDay[k].kcal; }, 0) / ks.length); };
    ready('M10', { long_days: { days: L.length, avg_kcal: avgOf(L) }, other_days: { days: O.length, avg_kcal: avgOf(O) } });
  })();

  // M12 タンパク達成日数（1.6g/kg目安）
  (function () {
    let achieved = 0, valid = 0;
    dayKeys.forEach(function (k) {
      const hw = gHistoricalWeight_(bLogs, k);
      if (hw === null || hw <= 0) return;
      valid += 1;
      if (byDay[k].protein >= 1.6 * hw) achieved += 1;
    });
    if (!valid) { insuff('M12'); return; }
    ready('M12', { achieved_days: achieved, valid_days: valid });
  })();

  // M13 記録日数（「達成率」表記禁止）
  (function () {
    const periodDays = (range === '7d') ? 7 : (range === '30d') ? 30 : (range === '90d') ? 90 : null;
    const trSet = {};
    let trDays = 0;
    tLogsAll.forEach(function (l) {
      const k = dateKeyOf_(new Date(l['training_date']));
      if (gIn_(k, b) && !trSet[k]) { trSet[k] = true; trDays += 1; }
    });
    const bwSet = {};
    let bwDays = 0;
    bLogs.forEach(function (r) {
      const k = dateKeyOf_(new Date(r['measured_at']));
      if (gIn_(k, b) && !bwSet[k]) { bwSet[k] = true; bwDays += 1; }
    });
    ready('M13', { period_days: periodDays, meal_days: dayKeys.length, training_days: trDays, weight_days: bwDays });
  })();

  // M5 目標対比（Goal Plans対比）
  (function () {
    const goalPlans = getGoalPlansCachedLocally_(userId);
    const activePlan = goalPlans ? goalPlans.active_plan : null;
    if (!activePlan) {
      blocks['M5'] = { status: 'insufficient', message: '目標プランが設定されていません', code: 'no_active_plan' };
      return;
    }
    const planStart = String(activePlan['start_date'] || '').slice(0, 10);
    const winFrom = (b.from && planStart) ? (planStart > b.from ? planStart : b.from) : (planStart || b.from);
    const winTo = b.to;
    
    if (!winFrom || winFrom > winTo) { insuff('M5'); return; }

    const targetKcal = toNumber_(activePlan['planned_target_calories'], null);
    if (!targetKcal || targetKcal <= 0) { insuff('M5'); return; }

    const dates = [];
    const cur = new Date(winFrom + 'T00:00:00');
    const end = new Date(winTo + 'T00:00:00');
    while (cur <= end) {
      dates.push(dateKeyOf_(cur));
      cur.setDate(cur.getDate() + 1);
    }
    const validDays = dates.length;
    if (validDays === 0) { insuff('M5'); return; }

    const winDayMap = {};
    let totalIntake = 0;
    let recordedDays = 0;
    mLogs.forEach(function(r) {
      const k = dateKeyOf_(new Date(r['timestamp']));
      if (k >= winFrom && k <= winTo) {
        winDayMap[k] = (winDayMap[k] || 0) + (Number(r['calories']) || 0);
      }
    });

    dates.forEach(function(k) {
      const c = winDayMap[k] || 0;
      if (c > 0) recordedDays += 1;
      totalIntake += c;
    });

    if (recordedDays < 3) { insuff('M5'); return; }

    const avgIntake = Math.round(totalIntake / validDays);
    const ratio = Math.round((avgIntake / targetKcal) * 100);
    const displayRatio = Math.min(ratio, 200);

    let underDays = 0, withinDays = 0, overDays = 0;
    dates.forEach(function(k) {
      const c = winDayMap[k] || 0;
      const r = (c / targetKcal) * 100;
      if (r < 90) underDays += 1;
      else if (r <= 110) withinDays += 1;
      else overDays += 1;
    });

    ready('M5', {
      active_plan: activePlan,
      valid_days: validDays,
      recorded_days: recordedDays,
      avg_intake: avgIntake,
      target_calories: targetKcal,
      ratio: ratio,
      display_ratio: displayRatio,
      under_days: underDays,
      within_days: withinDays,
      over_days: overDays
    });
  })();

  return {
    range: range,
    notes: {
      meal_time: '時間帯の分類は記録された時刻を基準としています。',
      stability: '表示区分（±200/400 kcal）は本アプリ内の変動幅を直感的に把握するための表示基準であり、医学・栄養学上の標準的な閾値ではありません。',
      protein_approx: 'タンパクg/kgは体重測定日の間は直近測定値を使用した近似値です。',
      protein_ref: '1日1.6g/kgを目安として集計した参考値です。',
      goal_disclaimer: '目標比は現在設定されている目標プランに基づく参考値です。'
    },
    blocks: blocks
  };
}

function apiGetBodyAnalysis(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || '7d');
  if (['7d', '30d', '90d', '1y', 'all'].indexOf(range) === -1) range = '7d';
  if (!user.isPremium) range = '7d';
  const tier = user.isPremium ? 'p' : 'f';
  const data = cached_('growth_body_' + userId + '_' + range + '_' + tier, 120, function () {
    return buildBodyAnalysis_(userId, range, user);
  });
  return { ok: true, data: data };
}

function buildBodyAnalysis_(userId, range, user) {
  const b = gBounds_(range);
  const bLogs = getRows('Body_Composition', function (r) { return String(r['user_id']) === String(userId); })
    .sort(function (a, z) { return new Date(a['measured_at']) - new Date(z['measured_at']); });
  const inR = bLogs.filter(function (r) { return gIn_(dateKeyOf_(new Date(r['measured_at'])), b); });
  const mLogs = getRows('logs', function (r) { return String(r['user_id']) === String(userId); });
  const tLogsAll = getRows('Training_Logs', function (r) { return String(r['user_id']) === String(userId); });

  const blocks = {};
  function ready(k, d) { blocks[k] = { status: 'ready', data: d }; }
  function insuff(k) { blocks[k] = { status: 'insufficient', message: 'まだデータが足りません' }; }
  function hidden(k, m) { blocks[k] = { status: 'hidden', message: m }; }

  // 直近28日回帰（B0a/B3共用・range非依存）
  const d28 = new Date(); d28.setDate(d28.getDate() - 27);
  const regLogs = bLogs.filter(function (r) {
    return toNumber_(r['weight_kg'], null) !== null && new Date(r['measured_at']) >= d28;
  });
  let slope = null;
  if (regLogs.length >= 5) {
    const t0 = new Date(regLogs[0]['measured_at']).getTime();
    slope = gLinRegSlope_(regLogs.map(function (r) {
      return { x: (new Date(r['measured_at']).getTime() - t0) / 86400000, y: toNumber_(r['weight_kg'], null) };
    }));
  }

  // B0a 週あたり変化
  (function () {
    if (slope === null) { insuff('B0a'); return; }
    ready('B0a', { weekly_change: Math.round(slope * 7 * 10) / 10 });
  })();

  // B3 4週間予測
  (function () {
    if (slope === null || !regLogs.length) { insuff('B3'); return; }
    const latest = toNumber_(regLogs[regLogs.length - 1]['weight_kg'], null);
    ready('B3', { pace_per_week: Math.round(slope * 7 * 10) / 10,
      predicted_weight: Math.round((latest + slope * 28) * 10) / 10 });
  })();

  // B1 BMIバンド
  (function () {
    const h = user.height;
    if (h === null || h <= 0 || !inR.length) { insuff('B1'); return; }
    const list = [];
    inR.forEach(function (r) {
      const w = toNumber_(r['weight_kg'], null);
      if (w === null) return;
      const bmi = Math.round(w / ((h / 100) * (h / 100)) * 10) / 10;
      list.push({ date: dateKeyOf_(new Date(r['measured_at'])), bmi: bmi,
        band: bmi < 18.5 ? '低体重' : (bmi < 25 ? '普通体重' : '肥満域') });
    });
    if (!list.length) { insuff('B1'); return; }
    ready('B1', list);
  })();

  // B4 月平均比較
  (function () {
    const now = new Date();
    const curM = todayKey_().slice(0, 7);
    const pd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevM = pd.getFullYear() + '-' + String(pd.getMonth() + 1).padStart(2, '0');
    function monthAvg(m) {
      const perDay = {};
      bLogs.forEach(function (r) {
        const k = dateKeyOf_(new Date(r['measured_at']));
        if (k.slice(0, 7) !== m) return;
        const w = toNumber_(r['weight_kg'], null);
        if (w !== null) perDay[k] = w;
      });
      const ks = Object.keys(perDay);
      if (ks.length < 3) return null;
      return Math.round(ks.reduce(function (s, k) { return s + perDay[k]; }, 0) / ks.length * 10) / 10;
    }
    const cur = monthAvg(curM), prev = monthAvg(prevM);
    if (cur === null && prev === null) { insuff('B4'); return; }
    ready('B4', { current_month: curM, current_avg: cur, previous_avg: prev,
      delta: (cur !== null && prev !== null) ? Math.round((cur - prev) * 10) / 10 : null, in_progress: true });
  })();

  // B0b 筋肉×脂肪スカッター
  (function () {
    const pts = [];
    inR.forEach(function (r) {
      const bf = toNumber_(r['body_fat_pct'], null);
      const sm = toNumber_(r['skeletal_muscle_kg'], null);
      if (bf !== null && sm !== null) pts.push({ body_fat_pct: bf, skeletal_muscle_kg: sm });
    });
    if (pts.length < 2) { insuff('B0b'); return; }
    ready('B0b', pts);
  })();

  // B6 筋肉量/体脂肪量比
  (function () {
    const series = [];
    inR.forEach(function (r) {
      const w = toNumber_(r['weight_kg'], null);
      const bf = toNumber_(r['body_fat_pct'], null);
      const sm = toNumber_(r['skeletal_muscle_kg'], null);
      if (w === null || bf === null || sm === null || bf <= 0) return;
      const fat = w * bf / 100;
      if (fat <= 0) return;
      series.push({ date: dateKeyOf_(new Date(r['measured_at'])), value: Math.round(sm / fat * 100) / 100 });
    });
    if (series.length < 2) { insuff('B6'); return; }
    ready('B6', { series: series,
      delta: Math.round((series[series.length - 1].value - series[0].value) * 100) / 100 });
  })();

  // B7 BMR未満日数（bmr無記録ならhidden・推定式補完禁止）
  (function () {
    const HIDE_MSG = 'BMRを記録すると摂取との比較が使えます。';
    const hasBmr = bLogs.some(function (r) { return toNumber_(r['bmr'], null) !== null; });
    if (!hasBmr) { hidden('B7', HIDE_MSG); return; }
    const byDay = {};
    mLogs.forEach(function (r) {
      const k = dateKeyOf_(new Date(r['timestamp']));
      if (!gIn_(k, b)) return;
      byDay[k] = (byDay[k] || 0) + (Number(r['calories']) || 0);
    });
    let below = 0, checked = 0;
    Object.keys(byDay).forEach(function (k) {
      let bestK = null, bestBmr = null;
      bLogs.forEach(function (r) {
        const bmr = toNumber_(r['bmr'], null);
        if (bmr === null) return;
        const rk = dateKeyOf_(new Date(r['measured_at']));
        if (rk > k) return;
        if (bestK === null || rk > bestK) { bestK = rk; bestBmr = bmr; }
      });
      if (bestBmr === null) return;
      checked += 1;
      if (byDay[k] < bestBmr) below += 1;
    });
    if (!checked) { hidden('B7', HIDE_MSG); return; }
    ready('B7', { below_days: below, checked_days: checked });
  })();

  // B9 体重×ペース
  (function () {
    const weight_series = [];
    inR.forEach(function (r) {
      const w = toNumber_(r['weight_kg'], null);
      if (w !== null) weight_series.push({ date: dateKeyOf_(new Date(r['measured_at'])), weight_kg: w });
    });
    if (!weight_series.length) { insuff('B9'); return; }
    const paceByDay = {};
    tLogsAll.forEach(function (l) {
      if (String(l['training_type']) !== 'cardio') return;
      const t = gCardioType_(l['exercise_name_snapshot']);
      if (t !== 'running' && t !== 'walking') return;
      const d = toNumber_(l['distance_km'], null);
      const dur = toNumber_(l['duration_min'], 0) || 0;
      if (d === null || d < 1 || dur <= 0) return;
      const k = dateKeyOf_(new Date(l['training_date']));
      if (!gIn_(k, b)) return;
      if (!paceByDay[k]) paceByDay[k] = { d: 0, dur: 0 };
      paceByDay[k].d += d;
      paceByDay[k].dur += dur;
    });
    ready('B9', { weight_series: weight_series,
      pace_series: Object.keys(paceByDay).sort().map(function (k) {
        return { date: k, pace: Math.round(paceByDay[k].dur / paceByDay[k].d * 100) / 100 };
      }) });
  })();

  return {
    range: range,
    notes: {
      bmi: 'BMI区分は日本肥満学会基準（低体重<18.5 / 普通体重18.5-25 / 肥満域≥25）の目安であり、健康度の評価ではありません。筋肉量が多い場合など、BMIだけでは体脂肪の状態を正確に表しません。',
      prediction: '予測は現在の傾向を単純延長した参考値です。目標体重の達成予測ではありません。',
      bmr: 'BMRは安静時の推定消費量であり、1日の必要摂取量そのものではありません。',
      ratio: '筋肉量/体脂肪量比は参考値であり、医学的な健康指標・評価スコアではありません。'
    },
    blocks: blocks
  };
}
