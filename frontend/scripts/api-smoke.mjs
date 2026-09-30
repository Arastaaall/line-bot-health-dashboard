import handler from '../api/index.ts';
import { dispatchRead } from '../src/server/readApi.ts';

const sheetNames = [
  'users', 'Training_Logs', 'Training_Sets', 'Body_Composition', 'logs',
  'Training_Master', 'Training_Menus', 'Goal_Plans', 'Nutrition_Reference',
];

const emptySheets = Object.fromEntries(sheetNames.map((name) => [name, [['header']]]));
const context = {
  sheets: {
    values: async (name) => emptySheets[name] ?? [['header']],
    batchValues: async (names) => new Map(names.map((name) => [name, emptySheets[name] ?? [['header']]])),
  },
  sheetMemo: new Map(),
  sheetPending: new Map(),
};

const readActions = [
  ['getTrainingMaster', {}],
  ['getTrainingMenus', {}],
  ['getTrainingLogs', {}],
  ['getTrainingLogDetail', { training_log_id: 'missing' }],
  ['getTrainingFormInit', {}],
  ['getTrainingBoard', {}],
  ['getDailyCalorieSummary', {}],
  ['getDashboardAll', {}],
  ['getDashboardData', {}],
  ['getBodyComposition', {}],
  ['getGoalPlans', {}],
  ['getNutritionAnalysis', {}],
  ['getFoodHistory', {}],
  ['getFoodDay', { date: '2026-09-18' }],
  ['getGrowthSummary', {}],
  ['getGrowthAll', {}],
  ['getTrainingAnalysis', {}],
  ['getMenuTrajectory', {}],
  ['getMealAnalysis', {}],
  ['getBodyAnalysis', {}],
];

for (const [action, params] of readActions) {
  const result = await dispatchRead(context, 'smoke-user', action, params);
  if (typeof result?.ok !== 'boolean') throw new Error(`${action}: invalid API result`);
}

function responseCapture() {
  const output = { headers: {}, statusCode: 200, body: null, ended: false };
  const response = {
    setHeader(name, value) { output.headers[name] = value; },
    status(code) { output.statusCode = code; return response; },
    json(body) { output.body = body; },
    end() { output.ended = true; },
  };
  return { output, response };
}

async function invoke(method, body) {
  const capture = responseCapture();
  await handler({ method, body }, capture.response);
  return capture.output;
}

globalThis.fetch = async (url) => {
  if (String(url).includes('api.line.me')) {
    return new Response(JSON.stringify({ userId: 'smoke-user' }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true, data: { smoke: true } }), { status: 200 });
};

const options = await invoke('OPTIONS', {});
const missingToken = await invoke('POST', { action: 'health' });
const mutationMissingToken = await invoke('POST', { action: 'deleteTrainingLog', params: { training_log_id: 'smoke-log' } });
const health = await invoke('POST', { token: 'smoke-token', action: 'health' });

if (options.statusCode !== 204) throw new Error('OPTIONS smoke failed');
if (missingToken.statusCode !== 401) throw new Error('auth guard smoke failed');
if (mutationMissingToken.statusCode !== 401) throw new Error('mutation auth guard smoke failed');
if (health.body?.ok !== true) throw new Error('health smoke failed');

console.log(`api-smoke passed: read=${readActions.length}, auth-and-handler=ok`);
