// Screen and System against the real device helper (fake backlight + fake systemctl logging argv),
// the auth stub for LAN clients, and the Advanced settings link/hint.
import {
  clearSystemctlLog,
  expect,
  helperPut,
  isKiosk,
  openScreen,
  STUBS,
  systemctlLog,
  test,
  touchTimeoutEnv,
} from './fixtures.ts';

test.beforeEach(async () => {
  await helperPut('/screen', { brightness: 60, timeout: 300 });
  clearSystemctlLog();
  await fetch(`${STUBS}/__test/auth`, { method: 'POST', body: JSON.stringify({ protection: 'unset' }) });
});

const raw = (percent: number): number => Math.max(15, Math.floor((percent * 255 + 50) / 100));

test('brightness drag reaches touch-timeout (debounced, final value on release); timeout choice too', async ({ page }) => {
  await openScreen(page, '#/screen');
  const puts: unknown[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().endsWith('/api/device/v1/screen')) puts.push(r.postDataJSON());
  });
  const slider = page.getByRole('slider', { name: 'Brightness' });
  await expect(slider).toHaveAttribute('aria-valuenow', '60');
  const box = await slider.boundingBox();
  if (!box) throw new Error('no slider box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.6, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.6 - i * 0.03), y);
  await page.mouse.up();
  const final = Number(await slider.getAttribute('aria-valuenow'));
  expect(final).toBeGreaterThanOrEqual(22);
  expect(final).toBeLessThanOrEqual(26);
  await expect.poll(touchTimeoutEnv).toBe(`TOUCH_TIMEOUT_ARGS=-b ${raw(final)} -t 300\n`);
  expect(systemctlLog()).toContain('try-restart touch-timeout.service');
  expect(puts.length).toBeLessThanOrEqual(3);
  expect(puts.at(-1)).toEqual({ brightness: final });

  await page.getByRole('radio', { name: '30 min' }).click();
  await expect(page.getByRole('radio', { name: '30 min' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(touchTimeoutEnv).toBe(`TOUCH_TIMEOUT_ARGS=-b ${raw(final)} -t 1800\n`);
});

test('kiosk: restart asks for confirmation, then calls power and shows the restart overlay', async ({ page }, info) => {
  test.skip(!isKiosk(info.project.name), 'loopback client: no password');
  await openScreen(page, '#/system');
  await expect(page.locator('.item', { hasText: 'Name' })).toContainText('Living Room');
  await expect(page.locator('.item', { hasText: 'Software' })).toContainText('0.1.0-test');
  await expect(page.getByRole('link', { name: 'Advanced settings' })).toHaveCount(0);
  await expect(page.getByText('http://192.168.1.50/services')).toBeVisible();

  await page.getByRole('button', { name: 'Power…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Power' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(systemctlLog()).not.toContain('reboot');

  await page.getByRole('button', { name: 'Power…' }).click();
  await dialog.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restarting…' })).toBeVisible();
  await expect.poll(systemctlLog).toContain('reboot');
});

test.describe('auth gateway', () => {
  // The browser logs the gateway's 401 itself; that is the expected handshake, not an app error.
  test.use({ allowHttpStatus: [401] });

  test('LAN client: power needs a password - set it in the sheet, then the call is retried', async ({ page }, info) => {
    test.skip(isKiosk(info.project.name), 'LAN-only behavior');
    await openScreen(page, '#/system');
    await expect(page.getByRole('link', { name: 'Advanced settings' })).toHaveAttribute('href', '/services');
    await page.getByRole('button', { name: 'Power…' }).click();
    await page.getByRole('dialog', { name: 'Power' }).getByRole('button', { name: 'Restart' }).click();

    const sheet = page.getByRole('dialog', { name: 'Set a password' });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Password').fill('correct horse');
    await sheet.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Restarting…' })).toBeVisible();
    await expect.poll(systemctlLog).toContain('reboot');
  });

  test('LAN client: with a password set, a wrong one is refused and the right one logs in', async ({ page }, info) => {
    test.skip(isKiosk(info.project.name), 'LAN-only behavior');
    await fetch(`${STUBS}/__test/auth`, { method: 'POST', body: JSON.stringify({ protection: 'risky', password: 'pw' }) });
    await openScreen(page, '#/system');
    await page.getByRole('button', { name: 'Power…' }).click();
    await page.getByRole('dialog', { name: 'Power' }).getByRole('button', { name: 'Shut down' }).click();
    const sheet = page.getByRole('dialog', { name: 'Password required' });
    await sheet.getByLabel('Password').fill('nope');
    await sheet.getByRole('button', { name: 'Continue' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Wrong password.');
    expect(systemctlLog()).not.toContain('poweroff');
    await sheet.getByLabel('Password').fill('pw');
    await sheet.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Shutting down…' })).toBeVisible();
    await expect.poll(systemctlLog).toContain('poweroff');
  });
});

test.describe('configurator down', () => {
  // The stub answers 500 on purpose; the browser logs each such response itself.
  test.use({ allowHttpStatus: [500] });

  test('a failing configurator only degrades the System screen', async ({ page }) => {
    await fetch(`${STUBS}/__test/config`, { method: 'POST', body: JSON.stringify({ down: true }) });
    try {
      await openScreen(page, '#/system');
      await expect(page.getByText('Some system details are not available right now.')).toBeVisible();
      await expect(page.locator('.item', { hasText: 'Software' })).toContainText('0.1.0-test');
      await expect(page.getByRole('button', { name: 'Power…' })).toBeVisible();
      await expect(page.locator('.connecting')).toHaveCount(0);
    } finally {
      await fetch(`${STUBS}/__test/config`, { method: 'POST', body: JSON.stringify({ down: false }) });
    }
  });
});
