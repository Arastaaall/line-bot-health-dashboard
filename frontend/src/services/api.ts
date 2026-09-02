import { getAccessToken } from './liff';

const GAS_URL = import.meta.env.VITE_GAS_URL;

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const RETRYABLE = [404, 500, 502, 503];

async function fetchWithRetry(body: string): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
  };
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GAS_URL, init);
      if (res.ok || RETRYABLE.indexOf(res.status) === -1) return res;
      lastStatus = res.status;
    } catch (e) {
      lastStatus = 0;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 900));
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
  const token = getAccessToken();
  if (!token) throw new ApiError('AUTH_FAILED', 'LINEトークン未取得です。再ログインしてください');

  const res = await fetchWithRetry(JSON.stringify({ token, action, params }));
  const json = await res.json();

  if (json?.ok === true) return json.data as T;
  if (json?.ok === false) {
    throw new ApiError(json.error?.code ?? 'SERVER_ERROR', json.error?.message ?? '不明なエラー');
  }
  if (json?.error) throw new ApiError('SERVER_ERROR', json.error);
  return json as T;
}