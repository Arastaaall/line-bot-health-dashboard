import assert from 'node:assert/strict';
import { dispatchRead, VERCEL_READ_ACTIONS } from '../src/server/readApi.ts';
import { dispatchMutation, isMutationAction, VERCEL_MUTATION_ACTIONS } from '../src/server/mutationApi.ts';

const expectedReads = [
  'getTrainingMaster', 'getTrainingMenus', 'getTrainingLogs', 'getTrainingLogDetail',
  'getTrainingFormInit', 'getTrainingBoard', 'getDailyCalorieSummary', 'getDashboardAll', 'getDashboardData',
  'getBodyComposition', 'getGoalPlans', 'getNutritionAnalysis', 'getFoodHistory', 'getFoodDay',
  'getGrowthSummary', 'getGrowthAll', 'getTrainingAnalysis', 'getMenuTrajectory', 'getMealAnalysis', 'getBodyAnalysis',
];
const expectedMutations = [
  'createTrainingMenu', 'updateTrainingMenu', 'updateTrainingMenuOrder', 'deleteTrainingMenu',
  'createTrainingLog', 'createTrainingLogsBatch', 'updateTrainingLog', 'deleteTrainingLog',
  'createBodyCompositionLog', 'deleteBodyCompositionLog',
];

assert.deepEqual([...VERCEL_READ_ACTIONS].sort(), [...expectedReads].sort());
assert.deepEqual([...VERCEL_MUTATION_ACTIONS].sort(), [...expectedMutations].sort());

const sheetNames = ['users', 'Training_Logs', 'Training_Sets', 'Body_Composition', 'logs', 'Training_Master', 'Training_Menus', 'Goal_Plans', 'Nutrition_Reference'];
const emptySheets = Object.fromEntries(sheetNames.map((name) => [name, [['header']]]));
const context = {
  sheets: {
    values: async (name) => emptySheets[name] ?? [['header']],
    batchValues: async (names) => new Map(names.map((name) => [name, emptySheets[name] ?? [['header']]])),
  },
  sheetMemo: new Map(),
  sheetPending: new Map(),
};

for (const action of expectedReads) {
  const params = action === 'getTrainingLogDetail' ? { training_log_id: 'missing' } : action === 'getFoodDay' ? { date: '2026-09-18' } : {};
  const result = await dispatchRead(context, 'contract-smoke-user', action, params);
  assert.equal(typeof result?.ok, 'boolean', `${action}: invalid result envelope`);
}

for (const action of expectedMutations) {
  assert.equal(isMutationAction(action), true, `${action}: mutation not registered`);
  const result = await dispatchMutation(context, 'contract-smoke-user', action, {});
  assert.equal(typeof result?.ok, 'boolean', `${action}: invalid result envelope`);
  assert.notEqual(result?.error?.code, 'NOT_FOUND', `${action}: dispatcher did not recognize action`);
}

console.log(`vercel-contract passed: read=${expectedReads.length}, mutation=${expectedMutations.length}`);

