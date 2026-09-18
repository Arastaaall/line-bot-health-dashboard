import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { dispatchRead } from '../src/server/readApi.ts';

process.env.TZ = 'Asia/Tokyo';

function jstParts(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

const formatDate = (value, pattern) => {
  const p = jstParts(value);
  return pattern.replace(/'/g, '')
    .replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
    .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
};

const cache = new Map();
const cacheStore = {
  get(key) { return cache.get(key) ?? null; },
  put(key, value) { cache.set(key, String(value)); },
  remove(key) { cache.delete(key); },
  removeAll(keys) { keys.forEach((key) => cache.delete(key)); },
};

const data = {
  users: [
    ['user_id', 'User_Name', 'weight', 'height', 'target_calories', 'is_premium', 'gender', 'age'],
    ['smoke-user', 'Parity User', 70, 170, 2200, true, '男性', 35],
  ],
  Training_Master: [
    ['master_id', 'exercise_name', 'exercise_type', 'body_part', 'met_category', 'default_met_value', 'is_bodyweight', 'is_active'],
    ['master-1', 'スクワット', 'strength', 'legs', 'general_weight', 5, false, true],
  ],
  Training_Menus: [
    ['menu_id', 'user_id', 'menu_name', 'training_type', 'master_id', 'training_group', 'display_order', 'is_active', 'created_at', 'updated_at'],
    ['menu-1', 'smoke-user', 'スクワット', 'strength', 'master-1', '下半身', 1, true, '2026-09-10T10:00:00+09:00', '2026-09-10T10:00:00+09:00'],
  ],
  Training_Logs: [
    ['training_log_id', 'user_id', 'menu_id', 'master_id', 'exercise_name_snapshot', 'training_type', 'training_date', 'created_at', 'duration_min', 'distance_km', 'rpe', 'memo', 'estimated_calories'],
    ['log-1', 'smoke-user', 'menu-1', 'master-1', 'スクワット', 'strength', '2026-09-18T10:00:00+09:00', '2026-09-18T10:05:00+09:00', '', '', 7, 'parity', 120],
  ],
  Training_Sets: [
    ['training_log_id', 'set_no', 'weight_kg', 'reps', 'rpe', 'is_bodyweight'],
    ['log-1', 1, 60, 10, 7, false],
  ],
  Body_Composition: [
    ['body_log_id', 'user_id', 'measured_at', 'created_at', 'measurement_device', 'weight_kg', 'body_fat_pct', 'skeletal_muscle_kg', 'muscle_mass_kg', 'body_water_pct', 'visceral_fat', 'bmr', 'waist_cm'],
    ['body-1', 'smoke-user', '2026-09-18T08:00:00+09:00', '2026-09-18T08:01:00+09:00', 'scale', 70, 20, 30, 30, 55, 8, 1600, 80],
  ],
  logs: [
    ['log_id', 'user_id', 'timestamp', 'menu_name', 'calories', 'protein', 'fat', 'carbs', 'fiber', 'calcium', 'iron', 'potassium', 'magnesium', 'zinc', 'vit_a', 'vit_c', 'vit_d', 'vit_e', 'vit_b1', 'vit_b2', 'vit_b6', 'vit_b12', 'folate', 'advice'],
    ['food-1', 'smoke-user', '2026-09-18T08:30:00+09:00', '朝食', 500, 30, 15, 50, 5, 100, 2, 300, 50, 3, 100, 20, 2, 1, 0.5, 0.5, 0.5, 1, 50, ''],
  ],
  Goal_Plans: [
    ['plan_id', 'user_id', 'status', 'start_date', 'planned_end_date'],
    ['plan-1', 'smoke-user', 'active', '2026-09-01', '2026-10-01'],
  ],
  Nutrition_Reference: [
    ['nutrient_id', 'nutrient_name', 'unit', 'gender', 'age_min', 'age_max', 'reference_type', 'reference_value', 'is_active'],
    ['fiber_男性_30_49', '食物繊維', 'g', '男性', 30, 49, '目標量', 22, true],
  ],
};

function rowsToValues(rows) { return rows; }

const fakeSheets = Object.fromEntries(Object.entries(data).map(([name, values]) => [name, {
  getDataRange: () => ({ getValues: () => values }),
  getRange: () => ({ getValues: () => [values[0]] }),
}]));

const gasContext = vm.createContext({
  Buffer,
  console,
  crypto: { createHash },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (name) => fakeSheets[name] }) },
  CacheService: { getUserCache: () => cacheStore },
  Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
  Utilities: {
    DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' },
    computeDigest: (algorithm, value) => Array.from(createHash(algorithm).update(String(value)).digest()),
    formatDate: (value, _timezone, pattern) => formatDate(value, pattern),
    newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value))) }),
    getUuid: () => 'smoke-uuid',
  },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  isNaN,
});

const gasFiles = [
  '../../GAS/utils.gs',
  '../../GAS/repositories.gs',
  '../../GAS/calculators.gs',
  '../../GAS/api_training.gs',
  '../../GAS/api_growth.gs',
  '../../GAS/api_nutrition.gs',
  '../../GAS/api_calories.gs',
  '../../GAS/api_bodycomp.gs',
  '../../GAS/api_goal_plans.gs',
];

for (const relative of gasFiles) {
  const filename = new URL(relative, import.meta.url);
  vm.runInContext(await readFile(filename, 'utf8'), gasContext, { filename: filename.pathname });
}

function gasResult(action, params) {
  vm.runInContext('resetSheetMemo_(); __perf = null; __trainingMasterMap = null;', gasContext);
  return vm.runInContext(`dispatchTraining('smoke-user', ${JSON.stringify(action)}, ${JSON.stringify(params)})`, gasContext);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const context = {
  sheets: {
    values: async (name) => rowsToValues(data[name] ?? [['header']]),
    batchValues: async (names) => new Map(names.map((name) => [name, rowsToValues(data[name] ?? [['header']])])),
  },
  sheetMemo: new Map(),
  sheetPending: new Map(),
};

const cases = [
  ['getTrainingMaster', {}],
  ['getTrainingMenus', {}],
  ['getTrainingLogs', { from: '2026-09-12', to: '2026-09-18' }],
  ['getTrainingLogDetail', { training_log_id: 'log-1' }],
  ['getTrainingFormInit', {}],
  ['getTrainingBoard', {}],
  ['getDailyCalorieSummary', { date: '2026-09-18' }],
  ['getDashboardAll', { date: '2026-09-18' }],
  ['getBodyComposition', {}],
  ['getGoalPlans', {}],
  ['getNutritionAnalysis', { range: '7d' }],
  ['getFoodHistory', { range: '7d' }],
  ['getFoodDay', { date: '2026-09-18' }],
  ['getGrowthSummary', { range: '7d' }],
  ['getGrowthAll', { range: '7d' }],
  ['getTrainingAnalysis', { range: '7d' }],
  ['getMenuTrajectory', { master_id: 'master-1' }],
  ['getMealAnalysis', { range: '7d' }],
  ['getBodyAnalysis', { range: '7d' }],
];

const rangeActions = [
  'getGrowthSummary', 'getGrowthAll', 'getTrainingAnalysis',
  'getMealAnalysis', 'getBodyAnalysis', 'getNutritionAnalysis', 'getFoodHistory',
];
const ranges = ['7d', '30d', '90d', '1y', 'all'];

async function runSuite(label) {
  const suiteCases = [...cases, ...ranges.flatMap((range) => rangeActions.map((action) => [action, { range }]))];
  for (const [action, params] of suiteCases) {
    const gas = gasResult(action, params);
    const vercel = await dispatchRead(context, 'smoke-user', action, params);
    const gasCanonical = JSON.stringify(canonical(gas));
    const vercelCanonical = JSON.stringify(canonical(vercel));
    if (gasCanonical !== vercelCanonical) {
      throw new Error(`${label}/${action}/${JSON.stringify(params)}: GAS/Vercel response mismatch\nGAS=${gasCanonical}\nVercel=${vercelCanonical}`);
    }
  }
  return suiteCases.length;
}

const premiumCases = await runSuite('premium');
data.users[1][5] = false;
cache.clear();
context.sheetMemo.clear();
context.sheetPending.clear();
const freeCases = await runSuite('free');

console.log(`gas-read-parity passed: premium=${premiumCases}, free=${freeCases}`);
