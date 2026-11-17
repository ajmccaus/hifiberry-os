// E2E suite against the real ACR + device helper behind the test gateway (tests/stack.sh).
// Constraint: one worker - every test shares the same audio backend; kiosk runs on both engines
// (the device uses WPE WebKit), the phone as a LAN client.

import { defineConfig, devices } from '@playwright/test';

const kiosk = { viewport: { width: 800, height: 480 }, hasTouch: true, baseURL: 'http://127.0.0.1:5180' };
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL: 'http://127.0.0.2:5180' };

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: { trace: 'retain-on-failure', deviceScaleFactor: 1 },
  projects: [
    { name: 'kiosk-chromium', use: { ...devices['Desktop Chrome'], ...kiosk } },
    { name: 'kiosk-webkit', use: { ...devices['Desktop Safari'], ...kiosk } },
    { name: 'phone-chromium', use: { ...devices['Desktop Chrome'], ...phone } },
    { name: 'phone-webkit', use: { ...devices['Desktop Safari'], ...phone } },
  ],
});
