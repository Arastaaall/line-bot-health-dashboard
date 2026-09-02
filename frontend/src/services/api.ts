import { getAccessToken } from './liff';

const GAS_URL = import.meta.env.VITE_GAS_URL;

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function fetchWithRetry(body: string): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
  };
  try {
    return await fetch(GAS_URL, init);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await fetch(GAS_URL, init);
    } catch (e2) {
      throw new ApiError('NETWORK', '通信に失敗しました。一時的なエラーの可能性があります。履歴を確認してから再操作してください。');
    }
  }
}

export async function callApi<T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new ApiError('AUTH_FAILED', 'LINEトークン未取得です。再ログインしてください');

  const res = await fetchWithRetry(JSON.stringify({ token, action, params }));

  if (!res.ok) {
    throw new ApiError('NETWORK', `サーバー通信エラー (HTTP ${res.status})。操作は完了している可能性があります。履歴を確認してから再操作してください。`);
  }
  const json = await res.json();

  if (json?.ok === true) return json.data as T;
  if (json?.ok === false) {
    throw new ApiError(json.error?.code ?? 'SERVER_ERROR', json.error?.message ?? '不明なエラー');
  }
  if (json?.error) throw new ApiError('SERVER_ERROR', json.error);
  return json as T;
}