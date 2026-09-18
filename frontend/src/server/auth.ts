import { createHash } from 'node:crypto';

type AuthCacheEntry = { userId: string; expiresAt: number };
const authCache = new Map<string, AuthCacheEntry>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function checkAuth(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const key = hashToken(token);
  const hit = authCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.userId;
  if (hit) authCache.delete(key);

  try {
    const response = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const profile = await response.json() as { userId?: string };
    if (!profile.userId) return null;
    authCache.set(key, { userId: profile.userId, expiresAt: Date.now() + 300000 });
    return profile.userId;
  } catch {
    return null;
  }
}
