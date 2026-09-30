import assert from 'node:assert/strict';
import { dateKeyOf, formatFoodTimestamp } from '../src/server/date.ts';
import { dispatchRead } from '../src/server/readApi.ts';

const userId = 'date-smoke-user';
const epoch = Date.UTC(1899, 11, 30);

// Sheets serial values represent the spreadsheet-local wall clock. The test
// fixture intentionally uses the workbook's JST wall clock, not a JS instant.
function sheetsSerial(wallClock) {
  return (Date.parse(`${wallClock}Z`) - epoch) / 86400000;
}

const mealSerial = sheetsSerial('2026-07-21T22:30:00');
const trainingSerial = sheetsSerial('2026-07-22T10:00:00');
const bodySerial = sheetsSerial('2026-07-22T08:00:00');
const menuSerial = sheetsSerial('2026-07-20T09:00:00');

assert.equal(dateKeyOf(mealSerial), '2026-07-21');
assert.equal(formatFoodTimestamp(mealSerial), '2026-07-21T22:30:00+09:00');

const data = {
  users: [
    ['user_id', 'User_Name', 'weight', 'height', 'target_calories', 'is_premium'],
    [userId, 'Date Test', 70, 170, 2200, true],
  ],
  Training_Master: [
    ['master_id', 'exercise_name', 'exercise_type', 'body_part', 'is_active'],
    ['master-1', 'スクワット', 'strength', 'legs', true],
  ],
  Training_Menus: [
    ['menu_id', 'user_id', 'menu_name', 'training_type', 'master_id', 'training_group', 'display_order', 'is_active', 'created_at', 'updated_at'],
    ['menu-1', userId, 'スクワット', 'strength', 'master-1', '下半身', 1, true, menuSerial, menuSerial],
  ],
  Training_Logs: [
    ['training_log_id', 'user_id', 'menu_id', 'master_id', 'exercise_name_snapshot', 'training_type', 'training_date', 'created_at', 'duration_min', 'distance_km', 'rpe', 'memo', 'estimated_calories'],
    ['training-1', userId, 'menu-1', 'master-1', 'スクワット', 'strength', trainingSerial, trainingSerial, '', '', 7, 'serial date', 120],
  ],
  Training_Sets: [
    ['training_log_id', 'set_no', 'weight_kg', 'reps', 'rpe', 'is_bodyweight'],
    ['training-1', 1, 60, 10, 7, false],
  ],
  Body_Composition: [
    ['body_log_id', 'user_id', 'measured_at', 'created_at', 'measurement_device', 'weight_kg', 'body_fat_pct', 'skeletal_muscle_kg', 'bmr'],
    ['body-1', userId, bodySerial, bodySerial, 'scale', 70, 20, 30, 1600],
  ],
  logs: [
    ['log_id', 'user_id', 'timestamp', 'menu_name', 'calories', 'protein', 'fat', 'carbs'],
    ['meal-1', userId, mealSerial, '夕食', 500, 30, 15, 50],
  ],
  Goal_Plans: [['plan_id', 'user_id', 'status', 'start_date', 'planned_end_date']],
};

function createContext() {
  return {
    sheets: {
      values: async (name) => data[name] ?? [['header']],
      batchValues: async (names) => new Map(names.map((name) => [name, data[name] ?? [['header']]])),
    },
    sheetMemo: new Map(),
    sheetPending: new Map(),
  };
}

const ranges = ['7d', '30d', '90d', '1y', 'all'];
const actions = ['getGrowthSummary', 'getGrowthAll', 'getTrainingAnalysis', 'getMealAnalysis', 'getBodyAnalysis'];
let checked = 0;

for (const action of actions) {
  for (const range of ranges) {
    const result = await dispatchRead(createContext(), userId, action, { range });
    assert.equal(result.ok, true, `${action}/${range} should succeed`);
    checked += 1;
  }
}

const dashboard = await dispatchRead(createContext(), userId, 'getDashboardAll', {});
assert.equal(dashboard.ok, true);
assert.equal(dashboard.data.legacy.daily.length, 7);
assert.equal(dashboard.data.legacy.ideal.calories, 2200);
assert.equal(dashboard.data.legacy.daily.some((day) => day.date === '2026-07-21'), false);

console.log(`date-regression passed: serial=${mealSerial}, growth_cases=${checked}, dashboard_legacy=ok`);
