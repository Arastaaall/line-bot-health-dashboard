import liff from '@line/liff';

const LIFF_ID = import.meta.env.VITE_LIFF_ID;

let initialized = false;

export async function initLiff(): Promise<boolean> {
  if (initialized) return true;
  try {
    await liff.init({ liffId: LIFF_ID });
    initialized = true;
    return true;
  } catch {
    // Do not expose provider errors or authentication material in browser logs.
    console.error('LIFF init failed');
    return false;
  }
}

export const isLoggedIn = () => liff.isLoggedIn();
export const login = () => liff.login();
export const logout = () => liff.logout();
export const getAccessToken = () => liff.getAccessToken();

export function notifySessionExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('liff-session-expired'));
}

export async function getUserId(): Promise<string | null> {
  try {
    const token: any = await liff.getDecodedIDToken();
    return token?.sub || null;
  } catch {
    return null;
  }
}
