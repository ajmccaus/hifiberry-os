// Volume slider and Sources against the real ACR: a drag reaches ACR, a server-side change moves the
// slider, mute is a toggle; Sources lists real players, marks the playing one, plays/pauses on tap.
import { acr, demo, expect, mpc, openScreen, resetAudio, test, volumeNow } from './fixtures.ts';

test.beforeEach(resetAudio);

test('dragging the volume slider reaches ACR; a server-side change moves the slider', async ({ page }) => {
  await openScreen(page, '#/');
  const slider = page.locator('.player-bar').getByRole('slider', { name: 'Volume' });
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  const box = await slider.boundingBox();
  if (!box) throw new Error('no slider box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * (0.5 + i * 0.03), y);
  await page.mouse.up();
  await expect.poll(volumeNow).toBeGreaterThanOrEqual(78);
  expect(await volumeNow()).toBeLessThanOrEqual(82);
  await expect(slider).toHaveAttribute('aria-valuenow', /^(7[89]|8[0-2])$/);

  await acr('/volume/set', { percentage: 23 });
  await expect(slider).toHaveAttribute('aria-valuenow', '23');
});

test('mute toggles to 0 and back to the saved level', async ({ page }) => {
  await openScreen(page, '#/');
  const bar = page.locator('.player-bar');
  await bar.getByRole('button', { name: 'Mute' }).click();
  await expect.poll(volumeNow).toBe(0);
  await expect(bar.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuenow', '0');
  await bar.getByRole('button', { name: 'Mute' }).click();
  await expect.poll(volumeNow).toBe(50);
  await expect(bar.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuenow', '50');
});

test('Sources lists the real players, marks the playing one, and taps play/pause', async ({ page }) => {
  await openScreen(page, '#/sources');
  const mpdRow = page.getByRole('button', { name: 'Radio & music' });
  const demoRow = page.getByRole('button', { name: 'demo' });
  await expect(mpdRow).toBeVisible();
  await expect(demoRow).toBeVisible();
  await expect(page.locator('.item.source.playing')).toHaveCount(0);

  mpc('-q', 'play', '1');
  await expect(page.locator('.item.source.playing')).toHaveText('Radio & music');

  await demoRow.click();
  await expect(page.locator('.item.source.playing')).toHaveText('demo');
  await expect.poll(() => mpc('status')).not.toContain('[playing]');

  await demoRow.click();
  await expect(page.locator('.item.source.playing')).toHaveCount(0);
  await expect(demoRow).toContainText('Paused');
  await demo({ type: 'state_changed', state: 'stopped' });
});

test('a source that cannot be started from here explains where to start it', async ({ page }) => {
  // ACR's player list as it looks with Spotify Connect installed but idle (no capabilities).
  await page.route('**/api/audiocontrol/players', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { players: unknown[] };
    body.players.push({ name: 'librespot', id: 'librespot', state: 'stopped', is_active: false, capabilities: [] });
    await route.fulfill({ response: res, json: body });
  });
  await openScreen(page, '#/sources');
  await page.getByRole('button', { name: 'Spotify Connect' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Choose this speaker in the Spotify app.' })).toBeVisible();
});
