import { getAccessToken, notifySessionExpired } from './liff';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_GAS_URL || '/api';
const GAS_URL = import.meta.env.VITE_GAS_URL;

function endpointForAction(_action: string): { url: string; backend: 'vercel' | 'gas' } {
  // With VITE_API_URL configured, Vercel is the only browser endpoint.
  // Read actions use Sheets API; mutations are server-side proxied to GAS
  // until Vercel has a distributed lock/dedup store.
  if (import.meta.env.VITE_API_URL) {
    return { url: API_URL, backend: 'vercel' };
  }
  if (GAS_URL) return { url: GAS_URL, backend: 'gas' };
  return { url: API_URL, backend: 'vercel' };
}

// 本番環境では通常ログを出さず、調査時だけ localStorage から有効化する。
// Dev 環境では計測ログと debug payload を有効にする。
const DEBUG = import.meta.env.DEV || (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('gasdebug') === '1';
  } catch {
    return false;
  }
})();

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const RETRYABLE = [404, 500, 502, 503];
const inFlightReads = new Map<string, Promise<unknown>>();
let requestSequence = 0;

function nextRequestId() {
  requestSequence += 1;
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function readKey(action: string, params: Record<string, unknown>) {
  return action + ':' + JSON.stringify(params);
}

async function fetchWithRetry(body: string, action: string, requestId: string): Promise<Response> {
  const endpoint = endpointForAction(action);
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
  };
  const isVercel = endpoint.backend === 'vercel';
  const isWriteLike = !action.startsWith('get') && action !== 'health';
  const maxAttempts = isVercel ? (isWriteLike ? 1 : 2) : 3;
  let lastStatus = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptStart = performance.now();
    const controller = isVercel ? new AbortController() : null;
    const timeoutId = controller ? window.setTimeout(() => controller.abort(), 8000) : null;
    try {
      const res = await fetch(endpoint.url, controller ? { ...init, signal: controller.signal } : init);
      const duration = Math.round(performance.now() - attemptStart);
      if (res.ok || isVercel || RETRYABLE.indexOf(res.status) === -1) {
        if (DEBUG) {
          console.log(`[API Attempt] ${action} backend=${endpoint.backend} requestId=${requestId} #${attempt + 1} status=${res.status} ${duration}ms`);
        }
        return res;
      }
      if (DEBUG) {
        console.warn(`[API Retry] ${action} backend=${endpoint.backend} requestId=${requestId} #${attempt + 1} status=${res.status} ${duration}ms`);
      }
      lastStatus = res.status;
    } catch (error) {
      const duration = Math.round(performance.now() - attemptStart);
      if (DEBUG) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[API Retry] ${action} backend=${endpoint.backend} requestId=${requestId} #${attempt + 1} network_or_cors ${duration}ms ${reason}`);
      }
      lastStatus = 0;
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
    if (attempt < maxAttempts - 1) {
      const waitMs = isVercel ? 250 : 900;
      if (DEBUG) console.log(`[API Retry] ${action} backend=${endpoint.backend} requestId=${requestId} waiting=${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  if (lastStatus === 0) {
    throw new ApiError('NETWORK', '通信に失敗しました。一時的なエラーの可能性があります。履歴を確認してから再操作してください。');
  }
  throw new ApiError('NETWORK', `サーバー通信エラー (HTTP ${lastStatus})。操作は完了している可能性があります。履歴を確認してから再操作してください。`);
}

export async function callApi<T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const startTime = performance.now();
  const requestId = nextRequestId();
  if (DEBUG) console.log(`[API Start] ${action} requestId=${requestId} @ ${Math.round(startTime)}ms`);

  const isRead = action.startsWith('get');
  const key = isRead ? readKey(action, params) : '';
  const existing = isRead ? inFlightReads.get(key) : undefined;
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    const token = getAccessToken();
    if (!token) {
      notifySessionExpired();
      throw new ApiError('AUTH_FAILED', 'LINEトークン未取得です。再ログインしてください');
    }
    const payload = DEBUG ? { token, action, params, debug: 1 } : { token, action, params };
    const res = await fetchWithRetry(JSON.stringify(payload), action, requestId);
    const json = await res.json();
    
    const duration = Math.round(performance.now() - startTime);
    if (DEBUG) {
      console.log(`[API End] ${action} requestId=${requestId} @ ${Math.round(performance.now())}ms (${duration}ms)`);

      // GAS内部の計測データ(_perf)があればコンソールに出力
      if ((json as any)?._perf) {
        console.log(`[GAS Perf] ${action}:`, (json as any)._perf);
      }
    }

    if (json?.ok === true) return json.data as T;
    if (json?.ok === false) {
      if (json.error?.code === 'AUTH_FAILED') notifySessionExpired();
      throw new ApiError(json.error?.code ?? 'SERVER_ERROR', json.error?.message ?? '不明なエラー');
    }
    if (json?.error) throw new ApiError('SERVER_ERROR', json.error);
    return json as T;
  })();

  if (isRead) {
    inFlightReads.set(key, request);
    request.then(
      () => { if (inFlightReads.get(key) === request) inFlightReads.delete(key); },
      () => { if (inFlightReads.get(key) === request) inFlightReads.delete(key); },
    );
  }
  return request;
}
