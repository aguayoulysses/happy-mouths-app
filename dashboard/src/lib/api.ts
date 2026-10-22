// One fetch wrapper. On the web the API is the same origin; in the iOS bundle
// VITE_API_URL points at production. Every call carries the session token.

import { getToken, clearToken } from "./auth";

export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (res.status === 401 && token) {
    await clearToken();
    window.dispatchEvent(new Event("hm:signout"));
  }
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

export const post = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) });

/** Multipart upload (photos). The browser sets the content type and boundary itself. */
export async function upload<T = unknown>(path: string, form: FormData): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(data.error ?? `Upload failed (${res.status})`, res.status);
  return data;
}
