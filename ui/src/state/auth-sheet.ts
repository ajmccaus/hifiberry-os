// Password sheet state: bridges the HTTP layer's 401 handshake to the UI prompt.
// Constraint: a "login" hint first tries to recover the CSRF token of an existing session silently.

import { signal } from '@preact/signals';
import * as auth from '../api/auth.ts';
import { HttpError, setAuthHandler, type AuthHint } from '../api/http.ts';

export interface AuthPrompt {
  hint: AuthHint;
  busy: boolean;
  error: string | null;
}

export const authPrompt = signal<AuthPrompt | null>(null);
let settle: ((ok: boolean) => void) | null = null;

function finish(ok: boolean): void {
  authPrompt.value = null;
  const s = settle;
  settle = null;
  s?.(ok);
}

export function startAuth(): void {
  setAuthHandler(async (hint) => {
    if (hint === 'login' && (await auth.refreshCsrf())) return true;
    settle?.(false);
    return new Promise<boolean>((resolve) => {
      settle = resolve;
      authPrompt.value = { hint, busy: false, error: null };
    });
  });
}

export async function submitPassword(password: string): Promise<void> {
  const prompt = authPrompt.value;
  if (!prompt || prompt.busy) return;
  authPrompt.value = { ...prompt, busy: true, error: null };
  try {
    await (prompt.hint === 'set-password' ? auth.setPassword(password) : auth.login(password));
    finish(true);
  } catch (e) {
    const tooMany = e instanceof HttpError && e.status === 429;
    const error = tooMany
      ? 'Too many attempts. Try again in a moment.'
      : prompt.hint === 'set-password'
        ? 'The password could not be set.'
        : 'Wrong password.';
    authPrompt.value = { ...prompt, busy: false, error };
  }
}

export const cancelAuth = (): void => finish(false);
