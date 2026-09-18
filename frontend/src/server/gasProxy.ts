import type { ApiRequest, ApiResult } from './types.ts';

const MUTATION_ACTIONS = new Set([
  'createTrainingMenu', 'updateTrainingMenu', 'updateTrainingMenuOrder', 'deleteTrainingMenu',
  'createTrainingLog', 'createTrainingLogsBatch', 'updateTrainingLog', 'deleteTrainingLog',
  'createBodyCompositionLog', 'deleteBodyCompositionLog',
]);

function failure(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } };
}

function gasUrl(): string {
  const value = process.env.VITE_GAS_URL;
  if (!value) throw new Error('GAS backend is not configured');
  return value;
}

function redirectUrl(response: Response, currentUrl: string): string | null {
  const location = response.headers.get('location');
  if (!location) return null;
  try { return new URL(location, currentUrl).toString(); } catch { return null; }
}

export function isMutationAction(action: string): boolean {
  return MUTATION_ACTIONS.has(action);
}

// Keep the GAS POST body and response contract unchanged. GAS web apps can
// redirect script.google.com to script.googleusercontent.com, so replay the
// POST explicitly instead of relying on a 302 implementation to preserve it.
export async function proxyMutation(request: ApiRequest): Promise<{ status: number; body: ApiResult<unknown> }> {
  const body = JSON.stringify(request);
  let url = gasUrl();
  let response: Response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = redirectUrl(response, url);
    if (!next) return { status: 502, body: failure('GAS_PROXY_ERROR', 'GAS応答の転送先を解決できません') };
    url = next;
  }

  const raw = await response!.text();
  try {
    const json = JSON.parse(raw) as ApiResult<unknown>;
    return { status: response!.status >= 200 && response!.status < 600 ? response!.status : 502, body: json };
  } catch {
    return { status: 502, body: failure('GAS_PROXY_ERROR', 'GASから不正な応答を受信しました') };
  }
}
