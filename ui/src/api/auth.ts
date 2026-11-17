// hifiberry-auth client: set-password / login / CSRF refresh for the nginx auth gateway.
// Constraint: endpoints and bodies follow hifiberry_auth/server.py; the session cookie is httpOnly,
// so the CSRF token returned here is the only credential JavaScript ever holds (in memory).

import { isRecord, str } from './guards.ts';
import { HttpError, rawFetch, readJson, setCsrfToken } from './http.ts';

const BASE = '/api/auth';

async function authPost(path: string, body: unknown): Promise<void> {
  const res = await rawFetch(`${BASE}/${path}`, { method: 'POST', body });
  const json = await readJson(res).catch(() => null);
  const csrf = isRecord(json) ? str(json, 'csrf') : undefined;
  if (!res.ok || !csrf) {
    const message = isRecord(json) ? str(json, 'message') : undefined;
    throw new HttpError(res.status, message ?? 'authentication failed');
  }
  setCsrfToken(csrf);
}

export const setPassword = (password: string): Promise<void> => authPost('set-password', { password });
export const login = (password: string): Promise<void> => authPost('login', { password });

/** Recovers the CSRF token of a still-valid session cookie (e.g. after a page reload). */
export async function refreshCsrf(): Promise<boolean> {
  try {
    const res = await rawFetch(`${BASE}/csrf`);
    const json = res.ok ? await readJson(res) : null;
    const csrf = isRecord(json) ? str(json, 'csrf') : undefined;
    if (!csrf) return false;
    setCsrfToken(csrf);
    return true;
  } catch {
    return false;
  }
}
