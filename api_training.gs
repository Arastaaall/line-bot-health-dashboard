// api_training.gs — Phase 1+2 トレーニングAPI群（最終修正版）

// ---------- 共通ヘルパー ----------
function getUserRecord_(userId) {
  const rows = getRows('users', function (r) { return String(r['user_id']) === String(userId); });
  const r = rows.length ? rows[0] : null;
  return {
    userId: userId,
    name: r ? (r['User_Name'] || r['user_name'] || 'ユーザー') : 'ユーザー',
    weight: r ? toNumber_(r['weight'], null) : null,
    targetCalories: r ? toNumber_(r['target_calories'], 2000) : 2000,
    isPremium: r ? toBool_(r['is_premium']) : false
  };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    return { ok: false, error: { code: 'SERVER_ERROR', message: '混み合っています。しばらくして再度お試しください' } };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function cached_(key, ttl, fn) {
  const c = CacheService.getUserCache();
  const hit = c.get(key);
  if (hit) return JSON.parse(hit);
  const data = fn();
  try { c.put(key, JSON.stringify(data), ttl); } catch (e) {}
  return data;
}

function invalidateLogCaches_(userId, dateKey) {
  const c = CacheService.getUserCache();
  c.remove('tlogs_' + userId);
  c.remove('summary_' + userId + '_' + todayKey_());
  if (dateKey) c.remove('summary_' + userId + '_' + dateKey);
}

function invalidateMenuCaches_(userId) {
  CacheService.getUserCache().remove('menus_' + userId);
}

function dedupCheck_(clientId) {
  if (!clientId) return null;
  const hit = CacheService.getUserCache().get('dedup_' + clientId);
  return hit ? JSON.parse(hit) : null;
}
function dedupSave_(clientId, payload) {
  if (!clientId) return;
  try { CacheService.getUserCache().put('dedup_' + clientId, JSON.stringify(payload), 600); } catch (e) {}
}

function getMasterDefaults_(masterId) {
  if (!masterId) return null;
  const m = findById('Training_Master', 'master_id', masterId);
  if (!m) return null;
  return {
    master_id: m['master_id'],
    exercise_name: String(m['exercise_name'] || ''),
    exercise_type: String(m['exercise_type'] || 'other'),
    body_part: String(m['body_part'] || 'other'),
    met_category: String(m['met_category'] || ''),
    default_met_value: toNumber_(m['default_met_value'], null),
    is_bodyweight: toBool_(m['is_bodyweight'])
  };
}

function deriveInputProfile_(master) {
  if (master.exercise_type === 'cardio') return 'cardio_basic';
  return master.is_bodyweight ? 'strength_basic' : 'strength_advanced';
}

function cellNum_(v) {
  const n = toNumber_(v, null);
  return n === null ? '' : n;
}

function getSetsOfLog_(logId) {
  return getRows('Training_Sets', function (s) { return String(s['training_log_id']) === String(logId); })
    .sort(function (a, b) { return (Number(a['set_no']) || 0) - (Number(b['set_no']) || 0); });
}

// ---------- Read系 ----------
function apiGetTrainingMaster(userId, params) {
  const rows = cached_('master_all_v1', 3600, function () {
    return getRows('Training_Master', function (r) { return toBool_(r['is_active']); });
  });
  return { ok: true, data: { exercises: rows } };
}

function apiGetTrainingMenus(userId, params) {
  const user = getUserRecord_(userId);
  const menus = cached_('menus_' + userId, 600, function () {
    return getRows('Training_Menus', function (r) {
      return String(r['user_id']) === String(userId) && toBool_(r['is_active']);
    }).sort(function (a, b) { return (Number(a['display_order']) || 0) - (Number(b['display_order']) || 0); });
  });
  return { ok: true, data: { menus: menus, limit: user.isPremium ? null : 5 } };
}

function apiGetTrainingLogs(userId, params) {
  const user = getUserRecord_(userId);
  const all = cached_('tlogs_' + userId, 60, function () {
    const logs = getRows('Training_Logs', function (r) { return String(r['user_id']) === String(userId); });
    const setsAll = getRows('Training_Sets');
    const byLog = {};
    setsAll.forEach(function (s) {
      const k = String(s['training_log_id']);
      (byLog[k] = byLog[k] || []).push(s);
    });
    logs.forEach(function (l) {
      l.sets = (byLog[String(l['training_log_id'])] || []).sort(function (a, b) { return (Number(a['set_no']) || 0) - (Number(b['set_no']) || 0); });
    });
    return logs.sort(function (a, b) { return new Date(b['training_date']) - new Date(a['training_date']); });
  });

  let from, to;
  const d7 = new Date();
  d7.setDate(d7.getDate() - 6);
  if (!user.isPremium) {
    from = dateKeyOf_(d7);
    to = todayKey_();
  } else {
    from = params.from || dateKeyOf_(d7);
    to = params.to || todayKey_();
  }
  const filtered = all.filter(function (l) {
    const k = dateKeyOf_(new Date(l['training_date']));
    return k >= from && k <= to;
  });
  return { ok: true, data: { logs: filtered, from: from, to: to, range_restricted: !user.isPremium } };
}

// ログ詳細＋同種目の過去履歴（トップレベル関数）
function apiGetTrainingLogDetail(userId, params) {
  const log = findById('Training_Logs', 'training_log_id', params.training_log_id);
  if (!log || String(log['user_id']) !== String(userId)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'ログが見つかりません' } };
  }
  const user = getUserRecord_(userId);
  if (!user.isPremium) {
    const d7 = new Date();
    d7.setDate(d7.getDate() - 6);
    if (dateKeyOf_(new Date(log['training_date'])) < dateKeyOf_(d7)) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'ログが見つかりません' } };
    }
  }

  const sets = getSetsOfLog_(params.training_log_id);

  const d7b = new Date(); d7b.setDate(d7b.getDate() - 6);
  const d90 = new Date(); d90.setDate(d90.getDate() - 89);
  const from = user.isPremium ? dateKeyOf_(d90) : dateKeyOf_(d7b);
  const to = todayKey_();
  const masterId = String(log['master_id'] || '');
  const sameName = String(log['exercise_name_snapshot']);

  const setsAll = getRows('Training_Sets');
  const countBy = {};
  setsAll.forEach(function (s) {
    const k = String(s['training_log_id']);
    countBy[k] = (countBy[k] || 0) + 1;
  });

  const history = getRows('Training_Logs', function (r) {
    if (String(r['user_id']) !== String(userId)) return false;
    if (String(r['training_log_id']) === String(log['training_log_id'])) return false;
    const match = masterId !== ''
      ? String(r['master_id'] || '') === masterId
      : String(r['exercise_name_snapshot']) === sameName;
    if (!match) return false;
    const k = dateKeyOf_(new Date(r['training_date']));
    return k >= from && k <= to;
  }).sort(function (a, b) { return new Date(b['training_date']) - new Date(a['training_date']); })
    .slice(0, 20)
    .map(function (r) {
      return {
        training_log_id: r['training_log_id'],
        training_date: r['training_date'],
        estimated_calories: r['estimated_calories'],
        duration_min: r['duration_min'],
        sets_count: countBy[String(r['training_log_id'])] || 0
      };
    });

  return { ok: true, data: { log: log, sets: sets, history: history, history_restricted: !user.isPremium } };
}

function apiGetDashboardAll(userId, params) {
  return {
    ok: true,
    data: {
      summary: apiGetDailyCalorieSummary(userId, params).data,
      dashboard: getDashboardDataCached(userId)
    }
  };
}

function apiGetTrainingFormInit(userId, params) {
  const menus = apiGetTrainingMenus(userId, params).data;
  const master = apiGetTrainingMaster(userId, params).data;
  return { ok: true, data: { menus: menus.menus, limit: menus.limit, exercises: master.exercises } };
}

// ---------- Write系 ----------
function apiCreateTrainingMenu(userId, params) {
  return withLock_(function () {
    const dup = dedupCheck_(params.client_id);
    if (dup) return dup;

    const user = getUserRecord_(userId);
    if (!user.isPremium) {
      const count = getRows('Training_Menus', function (r) {
        return String(r['user_id']) === String(userId) && toBool_(r['is_active']);
      }).length;
      if (count >= 5) return { ok: false, error: { code: 'LIMIT_EXCEEDED', message: '無料プランのマイメニューは5件までです' } };
    }

    const name = String(params.menu_name || '').trim();
    if (!name) return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'menu_nameは必須です' } };

    let masterId = params.master_id || '';
    let trainingType = params.training_type || 'other';
    let inputProfile = params.input_profile || '';
    let bodyPart = params.body_part || 'other';
    if (masterId) {
      const master = getMasterDefaults_(masterId);
      if (!master) return { ok: false, error: { code: 'NOT_FOUND', message: 'master_idが見つかりません' } };
      trainingType = master.exercise_type;
      inputProfile = deriveInputProfile_(master);
      bodyPart = params.body_part || master.body_part;
    }
    if (!inputProfile) inputProfile = 'strength_basic';

    const existing = getRows('Training_Menus', function (r) { return String(r['user_id']) === String(userId); });
    const maxOrder = existing.reduce(function (m, r) { return Math.max(m, Number(r['display_order']) || 0); }, 0);

    const now = nowIso_();
    const menu = {
      menu_id: makeId_('tmu'),
      user_id: userId,
      master_id: masterId,
      training_group: String(params.training_group || 'その他'),
      body_part: bodyPart,
      menu_name: name,
      training_type: trainingType,
      input_profile: inputProfile,
      display_order: maxOrder + 1,
      is_active: true,
      created_at: now,
      updated_at: now
    };
    appendRowObj('Training_Menus', menu);
    invalidateMenuCaches_(userId);
    const res = { ok: true, data: { menu_id: menu.menu_id } };
    dedupSave_(params.client_id, res);
    return res;
  });
}

function apiUpdateTrainingMenu(userId, params) {
  return withLock_(function () {
    const menu = findById('Training_Menus', 'menu_id', params.menu_id);
    if (!menu || String(menu['user_id']) !== String(userId)) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'メニューが見つかりません' } };
    }
    const patch = { updated_at: nowIso_() };
    if (params.display_order !== undefined && params.display_order !== null) patch['display_order'] = toNumber_(params.display_order, 0);
    if (params.menu_name) patch['menu_name'] = String(params.menu_name).trim();
    if (params.training_group !== undefined) patch['training_group'] = String(params.training_group || 'その他');
    updateRowById('Training_Menus', 'menu_id', params.menu_id, patch);
    invalidateMenuCaches_(userId);
    return { ok: true, data: { menu_id: params.menu_id } };
  });
}

function apiDeleteTrainingMenu(userId, params) {
  return withLock_(function () {
    const menu = findById('Training_Menus', 'menu_id', params.menu_id);
    if (!menu || String(menu['user_id']) !== String(userId)) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'メニューが見つかりません' } };
    }
    updateRowById('Training_Menus', 'menu_id', params.menu_id, { is_active: false, updated_at: nowIso_() });
    invalidateMenuCaches_(userId);
    return { ok: true, data: { menu_id: params.menu_id } };
  });
}

function apiCreateTrainingLog(userId, params) {
  return withLock_(function () {
    const dup = dedupCheck_(params.client_id);
    if (dup) return dup;

    const user = getUserRecord_(userId);
    const dateKey = params.training_date ? dateKeyOf_(new Date(params.training_date)) : todayKey_();

    if (!user.isPremium) {
      const count = getRows('Training_Logs', function (r) {
        return String(r['user_id']) === String(userId) && dateKeyOf_(new Date(r['training_date'])) === dateKey;
      }).length;
      if (count >= 7) return { ok: false, error: { code: 'LIMIT_EXCEEDED', message: '無料プランは1日7件までです' } };
    }

    const errors = validateTrainingLogBase_(params).concat(validateSets_(params.sets));
    if (errors.length) return { ok: false, error: { code: 'VALIDATION_ERROR', message: errors.join(' / ') } };

    let masterId = params.master_id || '';
    let exerciseName = String(params.exercise_name || '').trim();
    if (params.menu_id) {
      const menu = findById('Training_Menus', 'menu_id', params.menu_id);
      if (!menu || String(menu['user_id']) !== String(userId)) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'menu_idが見つかりません' } };
      }
      if (!exerciseName) exerciseName = String(menu['menu_name']);
      if (!masterId) masterId = String(menu['master_id'] || '');
    }
    let metCategory = '';
    let defaultMet = null;
    if (masterId) {
      const master = getMasterDefaults_(masterId);
      if (master) {
        if (!exerciseName) exerciseName = master.exercise_name;
        metCategory = master.met_category;
        defaultMet = master.default_met_value;
      }
    }
    if (!exerciseName) return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'exercise_nameは必須です' } };

    const rpeResolved = resolveRpe_(params);
    const bodyWeight = user.weight !== null ? user.weight : 60;

    let calc;
    if (params.training_type === 'cardio') {
      calc = calculateCardioCalories({
        exerciseName: exerciseName,
        duration_min: toNumber_(params.duration_min, null),
        distance_km: toNumber_(params.distance_km, null),
        defaultMet: defaultMet || 3.5,
        body_weight: bodyWeight
      });
    } else {
      calc = calculateStrengthCalories({
        sets: params.sets || [],
        body_weight: bodyWeight,
        metCategory: metCategory,
        duration_min: toNumber_(params.duration_min, null),
        rpe: rpeResolved.rpe
      });
    }

    const now = nowIso_();
    const logId = makeId_('tl');
    appendRowObj('Training_Logs', {
      training_log_id: logId,
      user_id: userId,
      menu_id: params.menu_id || '',
      master_id: masterId,
      exercise_name_snapshot: exerciseName,
      training_type: params.training_type,
      training_date: params.training_date,
      duration_min: cellNum_(params.duration_min),
      distance_km: cellNum_(params.distance_km),
      incline_pct: cellNum_(params.incline_pct),
      rpe: rpeResolved.rpe === null ? '' : rpeResolved.rpe,
      rpe_source: rpeResolved.rpe_source,
      estimated_calories: calc.calories,
      calorie_estimation_method: calc.method,
      calorie_formula_version: FORMULA_VERSION,
      body_weight: bodyWeight,
      memo: params.memo || '',
      created_at: now,
      updated_at: now
    });

    // セットは一括書き込み
    const setRows = (params.sets || []).map(function (s, i) {
      const isBw = toBool_(s.is_bodyweight);
      const wRaw = toNumber_(s.weight_kg, null);
      return {
        set_id: makeId_('ts'),
        training_log_id: logId,
        set_no: i + 1,
        weight_kg: (isBw && wRaw === null) ? 0 : cellNum_(s.weight_kg),
        reps: toNumber_(s.reps, 0),
        rpe: cellNum_(s.rpe),
        is_bodyweight: isBw,
        duration_sec: cellNum_(s.duration_sec),
        rest_sec: cellNum_(s.rest_sec),
        memo: s.memo || '',
        created_at: now
      };
    });
    appendRowsObjs('Training_Sets', setRows);

    invalidateLogCaches_(userId, dateKey);
    const res = { ok: true, data: {
      training_log_id: logId,
      estimated_calories: calc.calories,
      calorie_estimation_method: calc.method,
      calorie_formula_version: FORMULA_VERSION,
      body_weight: bodyWeight
    } };
    dedupSave_(params.client_id, res);
    return res;
  });
}

function apiUpdateTrainingLog(userId, params) {
  return withLock_(function () {
    const log = findById('Training_Logs', 'training_log_id', params.training_log_id);
    if (!log || String(log['user_id']) !== String(userId)) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'ログが見つかりません' } };
    }

    const patch = { updated_at: nowIso_() };
    ['training_date', 'duration_min', 'distance_km', 'incline_pct', 'memo'].forEach(function (k) {
      if (params[k] !== undefined) patch[k] = params[k];
    });
    if (params.rpe !== undefined || params.rpe_label !== undefined) {
      const r = resolveRpe_(params);
      patch['rpe'] = r.rpe === null ? '' : r.rpe;
      patch['rpe_source'] = r.rpe_source;
    }

    let sets = null;
    if (params.sets !== undefined) {
      const errs = validateSets_(params.sets);
      if (errs.length) return { ok: false, error: { code: 'VALIDATION_ERROR', message: errs.join(' / ') } };
      sets = params.sets;
    }

    const bodyWeight = toNumber_(log['body_weight'], 60);
    const merged = Object.assign({}, log, patch);
    const master = getMasterDefaults_(String(log['master_id'] || ''));

    let calc;
    if (String(log['training_type']) === 'cardio') {
      calc = calculateCardioCalories({
        exerciseName: String(log['exercise_name_snapshot']),
        duration_min: toNumber_(merged['duration_min'], null),
        distance_km: toNumber_(merged['distance_km'], null),
        defaultMet: (master && master.default_met_value) || 3.5,
        body_weight: bodyWeight
      });
    } else {
      // セット未指定なら既存セットで再計算
      const useSets = sets !== null ? sets : getSetsOfLog_(params.training_log_id);
      calc = calculateStrengthCalories({
        sets: useSets,
        body_weight: bodyWeight,
        metCategory: master ? master.met_category : '',
        duration_min: toNumber_(merged['duration_min'], null),
        rpe: toNumber_(merged['rpe'], null)
      });
    }
    patch['estimated_calories'] = calc.calories;
    patch['calorie_estimation_method'] = calc.method;
    patch['calorie_formula_version'] = FORMULA_VERSION;

    updateRowById('Training_Logs', 'training_log_id', params.training_log_id, patch);

    // setsは置換方式
    if (sets !== null) {
      deleteRowsByForeignKey('Training_Sets', 'training_log_id', params.training_log_id);
      const now = nowIso_();
      const setRows = sets.map(function (s, i) {
        const isBw = toBool_(s.is_bodyweight);
        const wRaw = toNumber_(s.weight_kg, null);
        return {
          set_id: makeId_('ts'),
          training_log_id: params.training_log_id,
          set_no: i + 1,
          weight_kg: (isBw && wRaw === null) ? 0 : cellNum_(s.weight_kg),
          reps: toNumber_(s.reps, 0),
          rpe: cellNum_(s.rpe),
          is_bodyweight: isBw,
          duration_sec: cellNum_(s.duration_sec),
          rest_sec: cellNum_(s.rest_sec),
          memo: s.memo || '',
          created_at: now
        };
      });
      appendRowsObjs('Training_Sets', setRows);
    }

    invalidateLogCaches_(userId, dateKeyOf_(new Date(log['training_date'])));
    return { ok: true, data: {
      training_log_id: params.training_log_id,
      estimated_calories: calc.calories,
      calorie_formula_version: FORMULA_VERSION
    } };
  });
}

function apiDeleteTrainingLog(userId, params) {
  return withLock_(function () {
    const log = findById('Training_Logs', 'training_log_id', params.training_log_id);
    if (!log || String(log['user_id']) !== String(userId)) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'ログが見つかりません' } };
    }
    deleteRowsByForeignKey('Training_Sets', 'training_log_id', params.training_log_id);
    deleteRowById('Training_Logs', 'training_log_id', params.training_log_id);
    invalidateLogCaches_(userId, dateKeyOf_(new Date(log['training_date'])));
    return { ok: true, data: { deleted: true } };
  });
}

function apiUpdateTrainingMenuOrder(userId, params) {
  return withLock_(function () {
    const orders = params.orders || [];
    if (!orders.length) return { ok: true, data: {} };
    const ids = orders.map(function (o) { return String(o.menu_id); });
    const mine = getRows('Training_Menus', function (r) {
      return String(r['user_id']) === String(userId) && ids.indexOf(String(r['menu_id'])) !== -1;
    });
    if (mine.length !== ids.length) return { ok: false, error: { code: 'NOT_FOUND', message: 'メニューが見つかりません' } };

    // 単一読み込みで一括更新
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Training_Menus');
    const values = sh.getDataRange().getValues();
    const header = values[0];
    const idIdx = header.indexOf('menu_id');
    const orderIdx = header.indexOf('display_order');
    const groupIdx = header.indexOf('training_group');
    const upIdx = header.indexOf('updated_at');
    const now = nowIso_();
    orders.forEach(function (o) {
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idIdx]) === String(o.menu_id)) {
          values[i][orderIdx] = Number(o.display_order) || 0;
          if (groupIdx !== -1) values[i][groupIdx] = String(o.training_group || 'その他');
          if (upIdx !== -1) values[i][upIdx] = now;
          sh.getRange(i + 1, 1, 1, values[i].length).setValues([values[i]]);
          break;
        }
      }
    });

    invalidateMenuCaches_(userId);
    return { ok: true, data: {} };
  });
}

// ---------- dispatch ----------
function dispatchTraining(userId, action, params) {
  switch (action) {
    case 'getTrainingMaster': return apiGetTrainingMaster(userId, params);
    case 'getTrainingMenus': return apiGetTrainingMenus(userId, params);
    case 'createTrainingMenu': return apiCreateTrainingMenu(userId, params);
    case 'updateTrainingMenu': return apiUpdateTrainingMenu(userId, params);
    case 'updateTrainingMenuOrder': return apiUpdateTrainingMenuOrder(userId, params);
    case 'deleteTrainingMenu': return apiDeleteTrainingMenu(userId, params);
    case 'getTrainingLogs': return apiGetTrainingLogs(userId, params);
    case 'getTrainingLogDetail': return apiGetTrainingLogDetail(userId, params);
    case 'createTrainingLog': return apiCreateTrainingLog(userId, params);
    case 'updateTrainingLog': return apiUpdateTrainingLog(userId, params);
    case 'deleteTrainingLog': return apiDeleteTrainingLog(userId, params);
    case 'getDailyCalorieSummary': return apiGetDailyCalorieSummary(userId, params);
    case 'getDashboardAll': return apiGetDashboardAll(userId, params);
    case 'getTrainingFormInit': return apiGetTrainingFormInit(userId, params);
    default: return { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown action: ' + action } };
  }
}