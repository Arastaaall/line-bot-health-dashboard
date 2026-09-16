import liff from '@line/liff';

const LIFF_ID = import.meta.env.VITE_LIFF_ID;

let initialized = false;

export async function initLiff(): Promise<boolean> {
  if (initialized) return true;
  try {
    await liff.init({ liffId: LIFF_ID });
    initialized = true;
    return true;
  } catch (e) {
    console.error('LIFF init failed:', e);
    return false;
  }
}

export const isLoggedIn = () => liff.isLoggedIn();
export const login = () => liff.login();
export const logout = () => liff.logout();
export const getAccessToken = () => liff.getAccessToken();

export async function getUserId(): Promise<string | null> {
  try {
    const token: any = await liff.getDecodedIDToken();
    return token?.sub || null;
  } catch {
    return null;
  }
}