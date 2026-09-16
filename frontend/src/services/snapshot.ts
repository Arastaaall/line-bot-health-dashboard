export type SnapshotType = 'dashboard' | 'growth';

const KEY_PREFIX = 'snapshot_v1_';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24時間以上古いデータは破棄

function buildKey(type: SnapshotType, userId: string, variant?: string) {
  const safeUserId = encodeURIComponent(userId);
  const safeVariant = variant ? '_' + encodeURIComponent(variant) : '';
  return `${KEY_PREFIX}${type}_${safeUserId}${safeVariant}`;
}

export function saveSnapshot(type: SnapshotType, userId: string, data: any, variant?: string) {
  try {
    localStorage.setItem(buildKey(type, userId, variant), JSON.stringify({ ts: Date.now(), data }));
  } catch (e) {
    // localStorageの容量超過・無効化は、API取得を妨げない。
    console.warn('snapshot save failed', e);
  }
}

export function loadSnapshot(type: SnapshotType, userId: string, variant?: string): any | null {
  try {
    const key = buildKey(type, userId, variant);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const age = Date.now() - parsed?.ts;
    if (typeof parsed?.ts !== 'number' || !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    // JSON破損やlocalStorage無効時は安全にnullを返し、API取得へフォールバックする。
    return null;
  }
}
