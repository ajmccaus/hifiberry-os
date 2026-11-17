// Backend loss against the real ACR: the UI drops playback state, shows Connecting, and recovers
// with a fresh snapshot when the audio controller is back (MPD keeps playing meanwhile).
import { expect, mpc, openNowPlaying, resetAudio, stack, test } from './fixtures.ts';

// The browser logs the refused WebSocket/HTTP connections itself while ACR is down.
test.use({ allowNetworkErrors: true });
test.beforeEach(resetAudio);
test.afterEach(() => stack('acr-up'));

test('audio controller down -> Connecting, no stale playing state -> recovers', async ({ page }) => {
  test.setTimeout(90_000);
  await openNowPlaying(page);
  mpc('-q', 'play', '2');
  const np = page.locator('.now-playing');
  await expect(np.locator('.np-title')).toHaveText('Second Silence');
  await expect(page.locator('.player-bar .mini-title')).toHaveText('Second Silence');

  stack('acr-down');
  await expect(page.locator('.connecting')).toBeVisible();
  await expect(page.getByText('Connecting…')).toBeVisible();
  await expect(np.locator('.np-title')).toHaveCount(0);
  await expect(page.locator('.player-bar .mini-title')).toHaveCount(0);
  await expect(np.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(page.locator('.player-bar').getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-disabled', 'true');

  stack('acr-up');
  await expect(page.locator('.connecting')).toHaveCount(0, { timeout: 30_000 });
  await expect(np.locator('.np-title')).toHaveText('Second Silence');
  await expect(np.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('.player-bar').getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuenow', '50');
});
