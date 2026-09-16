const KEY_PREFIX = 'snapshot_v1_';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7日以上古いデータは破棄

export function saveSnapshot(userId: string, data: any) {
  try {
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) { console.warn('snapshot save failed', e); }
}

export function loadSnapshot(userId: string): any | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > MAX_AGE_MS) {
      localStorage.removeItem(KEY_PREFIX + userId);
      return null;
    }
    return data;
  } catch { return null; }
}