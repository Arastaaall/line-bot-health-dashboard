import { dispatchMutation } from '../src/server/mutationApi.ts';
import { MemoryMutationStore } from '../src/server/mutationStore.ts';

const data = {
  users: [
    ['user_id', 'User_Name', 'weight', 'height', 'is_premium'],
    ['smoke-user', 'Smoke User', 70, 170, true],
    ['other-user', 'Other User', 80, 180, true],
  ],
  Training_Master: [
    ['master_id', 'exercise_name', 'exercise_type', 'body_part', 'is_bodyweight', 'default_met_value', 'met_category', 'is_active'],
    ['master-1', 'スクワット', 'strength', 'legs', false, 5, 'heavy_compound', true],
  ],
  Training_Menus: [
    ['menu_id', 'user_id', 'master_id', 'menu_name', 'training_type', 'input_profile', 'display_order', 'is_active', 'created_at', 'updated_at'],
    ['other-menu', 'other-user', 'master-1', '他人のメニュー', 'strength', 'strength_advanced', 1, true, '2026-09-01T00:00:00', '2026-09-01T00:00:00'],
  ],
  Training_Logs: [['training_log_id', 'user_id', 'training_type', 'training_date', 'body_weight']],
  Training_Sets: [['set_id', 'training_log_id', 'set_no', 'reps']],
  Body_Composition: [['body_log_id', 'user_id', 'measured_at', 'created_at', 'weight_kg', 'measurement_device']],
};

const writes = [];
const sheets = {
  async values(name) { return data[name] ?? [['header']]; },
  async batchValues(names) { return new Map(names.map((name) => [name, data[name] ?? [['header']]])); },
  async sheetProperties() { return new Map(Object.keys(data).map((title, index) => [title, { title, sheetId: index + 1 }])); },
  async batchUpdate(requests) { writes.push(requests); },
};

function context(store = new MemoryMutationStore()) {
  return { sheets, sheetMemo: new Map(), sheetPending: new Map(), mutationStore: store };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const menuParams = { client_id: 'menu-client', menu_name: '=安全な文字列', master_id: 'master-1' };
const menuContext = context();
const menuCreated = await dispatchMutation(menuContext, 'smoke-user', 'createTrainingMenu', menuParams);
assert(menuCreated.ok === true, 'menu create failed');
const menuWrites = writes.at(-1);
const menuAppend = menuWrites.find((request) => request.appendCells)?.appendCells;
const menuNameCell = menuAppend.rows[0].values.find((cell) => cell.userEnteredValue?.stringValue === '=安全な文字列');
assert(menuNameCell, 'formula-like menu input was not written as stringValue');
const writesAfterMenu = writes.length;
const menuDuplicate = await dispatchMutation(menuContext, 'smoke-user', 'createTrainingMenu', menuParams);
assert(JSON.stringify(menuDuplicate) === JSON.stringify(menuCreated), 'menu idempotency failed');
assert(writes.length === writesAfterMenu, 'idempotent menu was written twice');

const foreignUpdate = await dispatchMutation(context(), 'smoke-user', 'updateTrainingMenu', { menu_id: 'other-menu', menu_name: '不正更新' });
assert(foreignUpdate.ok === false && foreignUpdate.error.code === 'NOT_FOUND', 'menu ownership failed');

const logCreated = await dispatchMutation(context(), 'smoke-user', 'createTrainingLog', {
  client_id: 'log-client', training_type: 'strength', training_date: '2026-09-30',
  master_id: 'master-1', sets: [{ reps: 10, weight_kg: 60 }], memo: '=memo',
});
assert(logCreated.ok === true, 'log create failed');
const logWrites = writes.at(-1);
assert(logWrites.filter((request) => request.appendCells).length === 2, 'log and sets were not one batchUpdate');

const partial = await dispatchMutation(context(), 'smoke-user', 'createTrainingLogsBatch', {
  logs: [
    { training_type: 'strength', training_date: '2026-09-30', master_id: 'master-1', sets: [{ reps: 5 }] },
    { training_type: 'invalid', training_date: '2026-09-30', sets: [] },
  ],
});
assert(partial.ok === false && partial.data.results[0].ok === true && partial.data.results[1].ok === false, 'batch partial-success contract failed');

const bodyCreated = await dispatchMutation(context(), 'smoke-user', 'createBodyCompositionLog', {
  client_id: 'body-client', measured_at: '2026-09-30', measurement_device: 'manual', weight_kg: 69,
});
assert(bodyCreated.ok === true, 'body composition create failed');
const bodyWrites = writes.at(-1);
const bodyAppend = bodyWrites.find((request) => request.appendCells)?.appendCells;
assert(bodyAppend, 'body composition append missing');

const lockedStore = new MemoryMutationStore();
await lockedStore.setIfAbsent('lock:dashboard-spreadsheet', 'other-owner', 20);
const locked = await dispatchMutation(context(lockedStore), 'smoke-user', 'updateTrainingMenu', { menu_id: 'other-menu' });
assert(locked.ok === false && locked.error.code === 'SERVER_ERROR', 'lock timeout contract failed');

console.log(`mutation-smoke passed: writes=${writes.length}`);
