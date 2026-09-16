import { callApi } from './api';
import { getUserId } from './liff';
import { loadSnapshot, saveSnapshot } from './snapshot';

let trainingFormInitPromise: Promise<any> | null = null;
let trainingFormInitPromiseVersion = -1;
let trainingFormInitData: any | null = null;
let cacheVersion = 0;

/** TrainingFormInitをprefetch、LogForm、MenuManagerで共有する。 */
export function getTrainingFormInitCached(): Promise<any> {
  if (trainingFormInitData !== null) return Promise.resolve(trainingFormInitData);
  if (trainingFormInitPromise && trainingFormInitPromiseVersion === cacheVersion) {
    return trainingFormInitPromise;
  }

  const requestVersion = cacheVersion;
  const request = callApi('getTrainingFormInit')
    .then((data: any) => {
      if (requestVersion === cacheVersion) trainingFormInitData = data;
      return data;
    });
  trainingFormInitPromise = request;
  trainingFormInitPromiseVersion = requestVersion;
  request.then(
    () => {
      if (trainingFormInitPromise === request) trainingFormInitPromise = null;
    },
    () => {
      if (trainingFormInitPromise === request) trainingFormInitPromise = null;
    },
  );
  return request;
}

/** メニュー変更成功後に呼び、古い一覧を再利用しない。 */
export function invalidateTrainingFormInitCache() {
  cacheVersion += 1;
  trainingFormInitData = null;
}

function toSnapshotSetRows(sets: any[] = []) {
  return sets.map((s, i) => ({
    set_id: s.set_id || `local-${Date.now()}-${i + 1}`,
    set_no: s.set_no || i + 1,
    weight_kg: s.weight_kg,
    reps: s.reps,
    rpe: s.rpe,
    is_bodyweight: !!s.is_bodyweight,
  }));
}

/** 保存成功後、既に存在するTrainingHome Snapshotだけを即時更新する。 */
export async function addLocalTrainingLogs(pseudoLogs: any[]) {
  if (!pseudoLogs.length) return;
  const userId = await getUserId();
  if (!userId) return;
  const snap = loadSnapshot('training_home', userId);
  if (!snap) return;

  const existing = Array.isArray(snap.logs) ? snap.logs : [];
  const existingIds = new Set(existing.map((log: any) => String(log.training_log_id)));
  const additions = pseudoLogs
    .filter((log) => log && log.training_log_id && !existingIds.has(String(log.training_log_id)))
    .map((log) => ({ ...log, sets: toSnapshotSetRows(log.sets || []) }));
  if (!additions.length) return;

  saveSnapshot('training_home', userId, {
    ...snap,
    logs: [...additions, ...existing],
    savedAt: Date.now(),
  });
}
