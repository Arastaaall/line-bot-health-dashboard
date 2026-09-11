// ===== Phase 7: Goal Plans =====

const GOAL_PLANS_HEADERS = [
  'plan_id', 'user_id', 'start_date', 'planned_end_date', 'status',
  'goal_mode', 'planned_target_weight', 'planned_target_months',
  'planned_target_calories', 'planned_tdee', 'source', 'created_at'
];

// シート作成（setup_sheets.gs から呼ばれる想定）
function ensureGoalPlansSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Goal_Plans');
  if (!sh) {
    sh = ss.insertSheet('Goal_Plans');
    sh.getRange(1, 1, 1, GOAL_PLANS_HEADERS.length).setValues([GOAL_PLANS_HEADERS]);
    sh.setFrozenRows(1);
  } else if ((sh.getRange(1, 1).getValue() || '') === '') {
    sh.getRange(1, 1, 1, GOAL_PLANS_HEADERS.length).setValues([GOAL_PLANS_HEADERS]);
    sh.setFrozenRows(1);
  } else {
    const current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const missing = GOAL_PLANS_HEADERS.filter(function (col) { return current.indexOf(col) === -1; });
    if (missing.length) sh.getRange(1, sh.getLastColumn() + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

// Migration: 既存UsersからGoal_Plansへ初期Planを作成
function migrateUsersToGoalPlans() {
  ensureGoalPlansSheet_();
  const users = getRows('users', function() { return true; });
  const existingPlans = getRows('Goal_Plans', function(r) { return String(r['user_id'] || '') !== ''; });
  const planByUser = {};
  existingPlans.forEach(function(p) {
    const uid = String(p['user_id']);
    if (!planByUser[uid] || String(p['status'] || '') === 'active') planByUser[uid] = p;
  });

  let created = 0, updated = 0, skipped = 0;
  users.forEach(function(u) {
    const uid = String(u['user_id']);
    if (!uid) { skipped++; return; }
    
    const tc = toNumber_(u['target_calories'], null);
    if (tc === null || tc <= 0) { skipped++; return; } // 目標カロリーなしは除外

    const mode = String(u['goal_mode'] || 'maintain');
    const isMaintain = (mode === 'maintain');
    let startStr = String(u['target_start_date'] || '').slice(0, 10);
    if (!startStr) startStr = getFirstLogDate_(uid);
    if (!startStr) startStr = dateKeyOf_(new Date());
    let endStr = String(u['target_end_date'] || '').slice(0, 10);
    if (!endStr && !isMaintain) {
      const months = toNumber_(u['target_months'], 3);
      const sd = new Date(startStr);
      sd.setDate(sd.getDate() + Math.round(months * 30));
      endStr = dateKeyOf_(sd);
    }
    const plan = {
      plan_id: 'plan_' + Utilities.getUuid().slice(0, 8),
      user_id: uid,
      start_date: startStr,
      planned_end_date: isMaintain ? '' : endStr,
      status: 'active',
      goal_mode: mode,
      planned_target_weight: isMaintain ? '' : toNumber_(u['target_weight'], ''),
      planned_target_months: isMaintain ? '' : toNumber_(u['target_months'], ''),
      planned_target_calories: tc,
      planned_tdee: toNumber_(u['tdee'], tc),
      source: 'initial_migration',
      created_at: new Date().toISOString()
    };
    const existing = planByUser[uid];
    if (!existing) {
      appendRowsObjs('Goal_Plans', [plan]);
      created++;
      return;
    }
    updateRowById('Goal_Plans', 'plan_id', existing['plan_id'], {
      start_date: plan.start_date,
      planned_end_date: plan.planned_end_date,
      status: existing['status'] || plan.status,
      goal_mode: existing['goal_mode'] || plan.goal_mode,
      planned_target_weight: plan.planned_target_weight,
      planned_target_months: plan.planned_target_months,
      planned_target_calories: plan.planned_target_calories,
      planned_tdee: plan.planned_tdee,
      source: existing['source'] || plan.source,
      created_at: existing['created_at'] || plan.created_at
    });
    updated++;
  });
  Logger.log('Migration done: created=' + created + ' updated=' + updated + ' skipped=' + skipped);
}

// ヘルパー: 初回ログ日付取得
function getFirstLogDate_(userId) {
  let minDate = null;
  
  // 1. Logs (timestamp)
  const logs = getRows('logs', function(r) { return String(r['user_id']) === String(userId); });
  logs.forEach(function(r) {
    const d = new Date(r['timestamp']);
    if (!isNaN(d.getTime())) {
      if (!minDate || d < minDate) minDate = d;
    }
  });
  
  // 2. Training_Logs (training_date)
  const tlogs = getRows('Training_Logs', function(r) { return String(r['user_id']) === String(userId); });
  tlogs.forEach(function(r) {
    const d = new Date(r['training_date']);
    if (!isNaN(d.getTime())) {
      if (!minDate || d < minDate) minDate = d;
    }
  });
  
  return minDate ? dateKeyOf_(minDate) : null;
}

// ユーザーのGoal_Plansを取得（active_plan, history, notes）
function getGoalPlans_(userId) {
  const plans = getRows('Goal_Plans', function(r) { return String(r['user_id']) === String(userId); });
  
  let activePlan = null;
  const history = [];

  plans.forEach(function(p) {
    const status = String(p['status'] || '').toLowerCase();
    if (status === 'active') {
      if (!activePlan || String(p['start_date'] || '') > String(activePlan['start_date'] || '')) {
        if (activePlan) history.push(activePlan);
        activePlan = p;
      } else {
        history.push(p);
      }
    } else {
      history.push(p);
    }
  });

  history.sort(function(a, b) {
    return String(b['start_date'] || '').localeCompare(String(a['start_date'] || ''));
  });

  return {
    active_plan: activePlan,
    history: history,
    notes: {
      disclaimer: '目標達成度および表示は現在設定されている目標プランに基づく参考値です。'
    }
  };
}

function apiGetGoalPlans(userId, params) {
  const user = getUserRecord_(userId);
  const tier = user.isPremium ? 'p' : 'f';
  const data = cached_('goalplans_' + userId + '_' + tier, 120, function() {
    return getGoalPlans_(userId);
  });
  return { ok: true, data: data };
}

// ==========================================
// Phase 7 修正: 共通キャッシュ経路の統一
// ==========================================

// 1. 共通キャッシュ経由でGoal_Plansを取得する内部ヘルパー
function getGoalPlansCached_(userId) {
  const user = getUserRecord_(userId);
  const tier = user.isPremium ? 'p' : 'f';
  // 既存の cached_ 関数（CacheService.getUserCache()を使用）とキー形式を統一
  return cached_('goalplans_' + userId + '_' + tier, 120, function () {
    return getGoalPlans_(userId);
  });
}

// 2. 目標期間終了バナーを生成する共通ヘルパー
function buildGoalPeriodBanner_(userId) {
  const gp = getGoalPlansCached_(userId);
  const active = gp && gp.active_plan;
  if (!active) return { show: false, message: '' };
  
  const endKey = String(active['planned_end_date'] || '').slice(0, 10);
  if (!endKey) return { show: false, message: '' };
  
  const show = todayKey_() > endKey; // 終了日当日は非表示
  return { 
    show: show, 
    message: show ? '目標期間が終了しています。現在の体重・体組成を確認し、必要に応じて目標を更新してください。' : '' 
  };
}

// 3. 既存の apiGetGoalPlans を共通キャッシュ経由に簡素化
function apiGetGoalPlans(userId, params) {
  return { ok: true, data: getGoalPlansCached_(userId) };
}

// 4. キャッシュ無効化ヘルパー（将来のPlan更新/削除時に呼び出す）
function invalidateGoalPlanCaches_(userId) {
  const cache = CacheService.getUserCache(); // cached_関数と同一ストアを使用
  const keys = [];
  ['p', 'f'].forEach(function (t) {
    keys.push('goalplans_' + userId + '_' + t);
    ['7d', '30d', '90d', '1y', 'all'].forEach(function (r) {
      keys.push('growth_' + userId + '_' + r + '_' + t);
      keys.push('growth_meal_' + userId + '_' + r + '_' + t);
    });
  });
  keys.forEach(function(k) { cache.remove(k); });
}