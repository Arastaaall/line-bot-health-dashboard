import { checkAuth } from '../src/server/auth.ts';
import { createRequestContext } from '../src/server/context.ts';
import { isMutationAction, proxyMutation } from '../src/server/gasProxy.ts';
import { dispatchRead } from '../src/server/readApi.ts';
import type { ApiRequest, ApiResult } from '../src/server/types.ts';

type VercelRequest = { method?: string; body?: unknown; on?: (event: string, callback: (chunk: Buffer) => void) => void };
type VercelResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): void;
  end(): void;
};

function failure(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } };
}

async function requestBody(req: VercelRequest): Promise<ApiRequest> {
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return JSON.parse(String(req.body)) as ApiRequest;
  if (req.body && typeof req.body === 'object') return req.body as ApiRequest;
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on?.('data', (chunk) => { raw += chunk.toString(); });
    req.on?.('end', () => {
      try { resolve(JSON.parse(raw || '{}') as ApiRequest); } catch { reject(new Error('invalid json')); }
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json(failure('METHOD_NOT_ALLOWED', 'POSTのみ対応しています')); return; }

  let request: ApiRequest;
  try {
    request = await requestBody(req);
  } catch {
    res.status(400).json(failure('VALIDATION_ERROR', 'リクエスト形式が不正です')); return;
  }

  const action = String(request.action ?? '');
  const params = request.params && typeof request.params === 'object' ? request.params : {};
  if (!request.token) { res.status(401).json(failure('AUTH_FAILED', 'Token is required')); return; }

  // Mutation remains executed by the original GAS implementation until a
  // shared distributed lock/dedup store is available for Vercel.
  if (isMutationAction(action)) {
    try {
      const proxied = await proxyMutation(request);
      res.status(proxied.status).json(proxied.body);
    } catch {
      res.status(502).json(failure('GAS_PROXY_ERROR', 'GASバックエンドへの転送に失敗しました'));
    }
    return;
  }

  const userId = await checkAuth(request.token);
  if (!userId) { res.status(401).json(failure('AUTH_FAILED', 'Invalid token or LINE API error')); return; }

  try {
    if (action === 'health') {
      res.status(200).json({ ok: true, data: { status: 'ok', method: 'POST', time: new Date().toISOString() } });
      return;
    }
    const context = createRequestContext();
    const result = await dispatchRead(context, userId, action, params);
    res.status(result.ok ? 200 : result.error.code === 'NOT_FOUND' ? 404 : 400).json(result);
  } catch {
    // Deliberately do not return exception details: they may contain provider configuration.
    res.status(500).json(failure('SERVER_ERROR', 'サーバー処理に失敗しました'));
  }
}
