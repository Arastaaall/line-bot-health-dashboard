import { getAccessToken } from './liff';

const GAS_URL = import.meta.env.VITE_GAS_URL;

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// GASリファクタ後は新形式 {ok, data}、完了前は旧形式(生JSON)の両対応
export async function callApi<T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new ApiError('AUTH_FAILED', 'LINEトークン未取得です。再ログインしてください');

  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, action, params }),
  });

  if (!res.ok) throw new ApiError('SERVER_ERROR', `HTTP ${res.status}`);
  const json = await res.json();

  if (json?.ok === true) return json.data as T;
  if (json?.ok === false) {
    throw new ApiError(json.error?.code ?? 'SERVER_ERROR', json.error?.message ?? '不明なエラー');
  }
  // 旧形式（GASリファクタ前の暫定対応）
  if (json?.error) throw new ApiError('SERVER_ERROR', json.error);
  return json as T;
}