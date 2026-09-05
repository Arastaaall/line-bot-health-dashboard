// api_bodycomp.gs — Phase 3 体組成（最終実装指示書準拠）

function invalidateBodyCaches_(userId) {
  CacheService.getUserCache().remove('bcomp_' + userId);
}

// measured_at正規化: 日付のみ→登録時点のJST時刻を補完（00:00固定にしない）
function normalizeMeasuredAt_(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw);
  if (s.indexOf('T') !== -1) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const base = new Date(s + 'T00:00:00');
  if (isNaN(base.getTime())) return null;
  const now = new Date();
  base.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
  return base;
}

// Users.weight同期（5章）: weight非NULL＋measured_at最大＋created_atタイブレーク
function syncUserWeight_(userId) {
  const rows = getRows('Body_Composition', function (r) {
    return String(r['user_id']) === String(userId);
  }).filter(function (r) {
    return toNumber_(r['weight_kg'], null) !== null;
  });
  if (!rows.length) return; // 0件ならUsers.weightは変更しない
  rows.sort(function (a, b) {
    const ta = new Date(a['measured_at']).getTime();
    const tb = new Date(b['measured_at']).getTime();
    if (tb !== ta) return tb - ta;
    return new Date(b['created_at']).getTime() - new Date(a['created_at']).getTime();
  });
  updateRowById('users', 'user_id', userId, { weight: toNumber_(rows[0]['weight_kg'], null) });
}

// ---------- Read ----------
function apiGetBodyComposition(userId, params) {
  const user = getUserRecord_(userId);
  const all = cached_('bcomp_' + userId, 60, function () {
    return getRows('Body_Composition', function (r) {
      return String(r['user_id']) === String(userId);
    }).sort(function (a, b) {
      const ta = new Date(a['measured_at']).getTime();
      const tb = new Date(b['measured_at']).getTime();
      if (tb !== ta) return tb - ta;
      return new Date(b['created_at']).getTime() - new Date(a['created_at']).getTime();
    });
  });

  // 2.1 期間制限（measured_at基準。無料は直近7日に強制）
  let from = params.from || null;
  const to = params.to || null;
  if (!user.isPremium) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    from = dateKeyOf_(d);
  }
  const weightTrend = all.filter(function (r) {
    const k = dateKeyOf_(new Date(r['measured_at']));
    if (from && k < from) return false;
    if (to && k > to) return false;
    return true;
  }).map(function (r) {
    return { body_log_id: r['body_log_id'], measured_at: r['measured_at'], weight_kg: toNumber_(r['weight_kg'], null) };  });

  // 2.2 詳細体組成: 詳細項目のいずれか非NULLのみ対象・最大2件（無料/PRO共通）
  const DETAIL_FIELDS = ['body_fat_pct', 'skeletal_muscle_kg', 'muscle_mass_kg', 'body_water_pct', 'visceral_fat', 'bmr', 'waist_cm'];
  const detailRecords = all.filter(function (r) {
    return DETAIL_FIELDS.some(function (f) { return toNumber_(r[f], null) !== null; });
  }).slice(0, 2).map(function (r) {
    return {
      measured_at: r['measured_at'],
      measurement_device: r['measurement_device'],
      body_fat_pct: toNumber_(r['body_fat_pct'], null),
      skeletal_muscle_kg: toNumber_(r['skeletal_muscle_kg'], null),
      muscle_mass_kg: toNumber_(r['muscle_mass_kg'], null),
      body_water_pct: toNumber_(r['body_water_pct'], null),
      visceral_fat: toNumber_(r['visceral_fat'], null),
      bmr: toNumber_(r['bmr'], null),
      waist_cm: toNumber_(r['waist_cm'], null)
    };
  });

  // 最新体重（期間無制限・syncUserWeight_と同基準）
  let latestWeight = null;
  for (let i = 0; i < all.length; i++) {
    const w = toNumber_(all[i]['weight_kg'], null);
    if (w !== null) { latestWeight = w; break; }
  }

  // BMIは都度計算（Users.height使用・DB非保存）
  let bmi = null;
  if (latestWeight !== null && user.height !== null && user.height > 0) {
    const hm = user.height / 100;
    bmi = Math.round((latestWeight / (hm * hm)) * 10) / 10;
  }

  return {
    ok: true,
    data: {
      weight_trend: weightTrend,
      detail_records: detailRecords,
      latest_weight_kg: latestWeight,
      bmi: bmi,
      plan_limits: { weight_days: user.isPremium ? null : 7, detail_records: 2 }
    }
  };
}

// ---------- Write: 登録（3.2の処理順序厳守） ----------
function apiCreateBodyCompositionLog(userId, params) {
  return withLock_(function () {
    // a+b. 正規化＆必須チェック
    const measuredAt = normalizeMeasuredAt_(params.measured_at);
    // c. 全フィールドバリデーション（1つでもNGなら全体拒否）
    const errors = validateBodyComposition_(params);
    if (!measuredAt) errors.push('measured_atの形式が不正です');
    if (errors.length) return { ok: false, error: { code: 'VALIDATION_ERROR', message: errors.join(' / ') } };

    // d. 冪等性
    const dup = dedupCheck_(params.client_id);
    if (dup) return dup;

    // e. 書き込み
    const now = nowIso_();
    const id = makeId_('bc');
    appendRowObj('Body_Composition', {
      body_log_id: id,
      user_id: userId,
      measured_at: measuredAt,
      measurement_device: params.measurement_device,
      weight_kg: toNumber_(params.weight_kg, null),
      body_fat_pct: cellNum_(params.body_fat_pct),
      skeletal_muscle_kg: cellNum_(params.skeletal_muscle_kg),
      muscle_mass_kg: cellNum_(params.muscle_mass_kg),
      body_water_pct: cellNum_(params.body_water_pct),
      visceral_fat: cellNum_(params.visceral_fat),
      bmr: cellNum_(params.bmr),
      waist_cm: cellNum_(params.waist_cm),
      other_data: params.other_data || '',
      memo: params.memo || '',
      created_at: now
    });

    // f. 同一Lock内で同期（TDEE/target_caloriesには一切触れない）
    syncUserWeight_(userId);
    invalidateBodyCaches_(userId);

    const res = { ok: true, data: { body_log_id: id } };
    dedupSave_(params.client_id, res);
    return res;
  });
}

// ---------- Write: 削除（3.3の処理順序厳守） ----------
function apiDeleteBodyCompositionLog(userId, params) {
  const log = findById('Body_Composition', 'body_log_id', params.body_log_id);
  if (!log || String(log['user_id']) !== String(userId)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '記録が見つかりません' } };
  }
  return withLock_(function () {
    deleteRowById('Body_Composition', 'body_log_id', params.body_log_id);
    syncUserWeight_(userId);
    invalidateBodyCaches_(userId);
    return { ok: true, data: { deleted: true } };
  });
}