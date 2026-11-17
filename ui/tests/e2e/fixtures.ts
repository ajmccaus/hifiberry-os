// Shared e2e helpers: direct backend access (ACR, helper, stubs, MPD), page hygiene checks
// (no console errors, no request leaving the origin except radio-browser), UI navigation.
// Constraint: tests reset the shared audio backend themselves; nothing here mocks ACR or the helper.

import { expect, test as base, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ACR = 'http://127.0.0.1:1080/api';
export const HELPER = 'http://127.0.0.1:1190/api/device/v1';
export const STUBS = 'http://127.0.0.1:1191';
export const KIOSK = 'http://127.0.0.1:5180';
export const LAN = 'http://127.0.0.2:5180';
const UI = fileURLToPath(new URL('../..', import.meta.url));
const RUN = `${UI}tests/.stack/`;

export async function acr(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(ACR + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

export const volumeNow = async (): Promise<number> => {
  const s = (await acr('/volume/state')) as { percentage: number };
  return s.percentage;
};

export const mpc = (...args: string[]): string =>
  execFileSync('mpc', ['-h', '127.0.0.1', '-p', '6600', ...args], { encoding: 'utf8' });

export const demo = (event: Record<string, unknown>): Promise<unknown> => acr('/player/demo/update', event);

/** Known audio state: nothing playing, MPD queue = the 3 fixture tracks in order, volume 50. */
export async function resetAudio(): Promise<void> {
  await demo({ type: 'state_changed', state: 'stopped' });
  await demo({ type: 'song_changed', song: null });
  mpc('-q', 'stop');
  mpc('-q', 'clear');
  mpc('-q', 'add', '/');
  mpc('-q', 'random', 'off');
  mpc('-q', 'repeat', 'off');
  await acr('/volume/set', { percentage: 50 });
}

export async function helperPut(path: string, body: unknown): Promise<void> {
  const res = await fetch(HELPER + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect(res.ok).toBe(true);
}

export const systemctlLog = (): string => readFileSync(`${RUN}systemctl.log`, 'utf8');
export const clearSystemctlLog = (): void => writeFileSync(`${RUN}systemctl.log`, '');
export const touchTimeoutEnv = (): string => {
  try {
    return readFileSync(`${RUN}state/touch-timeout.env`, 'utf8');
  } catch {
    return '';
  }
};

export const stack = (cmd: 'acr-down' | 'acr-up'): void => {
  execFileSync('bash', [`${UI}tests/stack.sh`, cmd], { stdio: 'inherit' });
};

const NETWORK_NOISE = /Failed to load resource|WebSocket|ERR_CONNECTION|status of 50\d/i;
const ALLOWED_FOREIGN = /^https:\/\/([a-z0-9-]+\.)*api\.radio-browser\.info$/;

/** Collects console errors and cross-origin requests; returns the assertion to run at the end. */
export function watch(page: Page, opts: { allowNetworkErrors?: boolean } = {}): () => void {
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !(opts.allowNetworkErrors && NETWORK_NOISE.test(m.text()))) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== KIOSK && url.origin !== LAN && !ALLOWED_FOREIGN.test(url.origin)) foreign.push(r.url());
  });
  return () => {
    expect(foreign, 'requests leaving the origin').toEqual([]);
    expect(errors, 'console errors').toEqual([]);
  };
}

export const test = base.extend<{ allowNetworkErrors: boolean; hygiene: void }>({
  allowNetworkErrors: [false, { option: true }],
  hygiene: [
    async ({ page, allowNetworkErrors }, use) => {
      const check = watch(page, { allowNetworkErrors });
      await use();
      check();
    },
    { auto: true },
  ],
});

export { expect };

export const isKiosk = (projectName: string): boolean => projectName.startsWith('kiosk');

/** Opens a screen by URL; on the kiosk (which starts on Now Playing) closes Now Playing first. */
export async function openScreen(page: Page, hash: string): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.locator('.player-bar')).toBeVisible();
  const np = page.locator('.now-playing.open');
  if (await np.count()) {
    await page.getByRole('button', { name: 'Close Now Playing' }).click();
    await expect(np).toHaveCount(0);
  }
}

export async function openNowPlaying(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.player-bar')).toBeVisible();
  if (!(await page.locator('.now-playing.open').count())) await page.locator('.bar-chevron').click();
  await expect(page.locator('.now-playing.open')).toBeVisible();
}
