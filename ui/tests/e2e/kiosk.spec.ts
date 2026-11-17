// Kiosk-mode rules (page loaded from 127.0.0.1): starts on Now Playing, returns to it after 60 s
// without interaction while something plays, no context menu or text selection; phones do neither.
import { expect, isKiosk, mpc, resetAudio, test } from './fixtures.ts';

test.beforeEach(resetAudio);

test('kiosk starts on Now Playing and returns to it after 60 s idle while playing', async ({ page }, info) => {
  test.skip(!isKiosk(info.project.name), 'kiosk-only behaviour');
  await page.clock.install();
  await page.goto('/#/sources');
  await expect(page.locator('.now-playing.open')).toBeVisible();
  await page.getByRole('button', { name: 'Close Now Playing' }).click();
  await expect(page.locator('.now-playing.open')).toHaveCount(0);

  await page.clock.fastForward(61_000);
  await expect(page.locator('.now-playing.open')).toHaveCount(0); // nothing playing: stay

  await page.locator('.top-bar').getByRole('button', { name: 'Radio' }).click(); // an interaction restarts the idle time
  mpc('-q', 'play', '1');
  await expect(page.locator('.player-bar .mini-title')).toHaveText('First Silence');
  await page.clock.fastForward(30_000);
  await expect(page.locator('.now-playing.open')).toHaveCount(0);
  await page.clock.fastForward(31_000);
  await expect(page.locator('.now-playing.open')).toBeVisible();

  const blocked = await page.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(blocked).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).userSelect || getComputedStyle(document.body).webkitUserSelect)).toBe('none');
});

test('a LAN browser starts on the screen it was opened on and never jumps to Now Playing', async ({ page }, info) => {
  test.skip(isKiosk(info.project.name), 'LAN-only behaviour');
  await page.clock.install();
  mpc('-q', 'play', '1');
  await page.goto('/#/sources');
  await expect(page.locator('.player-bar .mini-title')).toHaveText('First Silence');
  await page.clock.fastForward(61_000);
  await expect(page.locator('.now-playing.open')).toHaveCount(0);
  await expect(page.locator('[data-screen=sources]')).toBeVisible();
});
