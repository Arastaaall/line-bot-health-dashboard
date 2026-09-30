import { getAccessToken, notifySessionExpired } from './liff';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function endpointForAction(_action: string): string { return API_URL; }

// 本番環境では通常ログを出さず、調査時だけ localStorage から有効化する。
// Dev 環境では計測ログと debug payload を有効にする。
const DEBUG = import.meta.env.DEV || (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('apidbg') === '1';
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
  const isWriteLike = !action.startsWith('get') && action !== 'health';
  const maxAttempts = isWriteLike ? 1 : 2;
  let lastStatus = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptStart = performance.now();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(endpoint, { ...init, signal: controller.signal });
      const duration = Math.round(performance.now() - attemptStart);
      if (res.ok || res.status < 500) {
        if (DEBUG) {
          console.log(`[API Attempt] ${action} requestId=${requestId} #${attempt + 1} status=${res.status} ${duration}ms`);
        }
        return res;
      }
      if (DEBUG) {
        console.warn(`[API Retry] ${action} requestId=${requestId} #${attempt + 1} status=${res.status} ${duration}ms`);
      }
      lastStatus = res.status;
    } catch (error) {
      const duration = Math.round(performance.now() - attemptStart);
      if (DEBUG) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[API Retry] ${action} requestId=${requestId} #${attempt + 1} network_or_cors ${duration}ms ${reason}`);
      }
      lastStatus = 0;
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (attempt < maxAttempts - 1) {
      const waitMs = 250;
      if (DEBUG) console.log(`[API Retry] ${action} requestId=${requestId} waiting=${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  if (lastStatus === 0) {
    throw new ApiError('NETWORK', '通信に失敗しました。一時的なエラーの可能性があります。履歴を確認してから再操作してください。');
  }
  throw new ApiError('NETWORK', `サーバー通信エラー (HTTP ${lastStatus})。操作は完了している可能性があります。履歴を確認してから再操作してください。`);
}

async function responseJson(res: Response): Promise<any> {
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(res.status >= 500 ? 'NETWORK' : 'SERVER_ERROR', 'サーバーから不正な応答を受信しました。時間を置いて再度お試しください。');
  }
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
    const json = await responseJson(res);
    
    const duration = Math.round(performance.now() - startTime);
    if (DEBUG) {
      console.log(`[API End] ${action} requestId=${requestId} @ ${Math.round(performance.now())}ms (${duration}ms)`);

      // Backend内部の計測データ(_perf)があればコンソールに出力
      if ((json as any)?._perf) {
        console.log(`[API Perf] ${action}:`, (json as any)._perf);
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
