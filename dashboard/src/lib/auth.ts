import { Preferences } from "@capacitor/preferences";

const KEY = "hm_token";
let cached: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const { value } = await Preferences.get({ key: KEY });
  cached = value ?? null;
  return cached;
}
export async function setToken(token: string) {
  cached = token;
  await Preferences.set({ key: KEY, value: token });
}
export async function clearToken() {
  cached = null;
  await Preferences.remove({ key: KEY });
}
