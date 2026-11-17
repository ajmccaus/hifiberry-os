// Same-origin JSON transport for every backend, with the nginx auth gateway's 401 handshake.
// Constraint: a 401 is retried at most once, and only after the registered auth handler succeeded.

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type AuthHint = 'set-password' | 'login';
type AuthHandler = (hint: AuthHint) => Promise<boolean>;

let csrfToken: string | null = null;
let authHandler: AuthHandler | null = null;

export const setCsrfToken = (token: string | null): void => {
  csrfToken = token;
};

export const setAuthHandler = (handler: AuthHandler): void => {
  authHandler = handler;
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  timeoutMs?: number;
}

/** One fetch, no auth handshake; resolves with the raw Response. */
export async function rawFetch(url: string, opts: RequestOptions = {}): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    return await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(res.status, 'response is not JSON');
  }
}

/** JSON request; on 401 asks the auth handler (password sheet) once, then retries. */
export async function request(url: string, opts: RequestOptions = {}): Promise<unknown> {
  let res = await rawFetch(url, opts);
  if (res.status === 401 && authHandler) {
    const hint: AuthHint = res.headers.get('WWW-Authenticate-Hint') === 'set-password' ? 'set-password' : 'login';
    if (await authHandler(hint)) res = await rawFetch(url, opts);
  }
  if (!res.ok) throw new HttpError(res.status, `${opts.method ?? 'GET'} ${url} failed: ${res.status}`);
  return readJson(res);
}
