// Now Playing against the real ACR: MPD track changes and play/pause, events pushed by the generic
// "demo" player, transport buttons following the player's current capabilities, artwork.
import { demo, expect, mpc, openNowPlaying, resetAudio, test } from './fixtures.ts';

test.beforeEach(resetAudio);

test('follows a real MPD track change and play/pause; buttons follow capabilities', async ({ page }) => {
  await openNowPlaying(page);
  const np = page.locator('.now-playing');
  mpc('-q', 'play', '1');
  await expect(np.locator('.np-title')).toHaveText('First Silence');
  await expect(np.locator('.np-artist')).toHaveText('Test Artist — Test Album');
  await expect(np.locator('.np-source')).toHaveText('Radio & music');
  const previous = np.getByRole('button', { name: 'Previous' });
  const next = np.getByRole('button', { name: 'Next' });
  // ACR/MPD: playing track 1 offers next but not previous.
  await expect(next).toBeVisible();
  await expect(previous).toBeHidden();

  await next.click();
  await expect(np.locator('.np-title')).toHaveText('Second Silence');
  await expect(previous).toBeVisible();
  await expect.poll(() => mpc('current')).toContain('Second Silence');

  await np.getByRole('button', { name: 'Pause' }).click();
  await expect(np.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect.poll(() => mpc('status')).toContain('[paused]');

  mpc('-q', 'play');
  await expect(np.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(np.getByRole('progressbar')).toBeVisible();
});

test('shows MPD cover art fetched through the proxy prefix', async ({ page }) => {
  await openNowPlaying(page);
  mpc('-q', 'play', '1');
  const img = page.locator('.now-playing .art-img').last();
  await expect(img).toHaveAttribute('src', /^\/api\/audiocontrol\/library\/mpd\/image\//);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test('follows events pushed by the demo player, idle state without a song', async ({ page }) => {
  await openNowPlaying(page);
  const np = page.locator('.now-playing');
  await demo({ type: 'song_changed', song: { title: 'Pushed Title', artist: 'Pushed Artist', album: 'Pushed Album', duration: 100 } });
  await demo({ type: 'state_changed', state: 'playing' });
  await expect(np.locator('.np-title')).toHaveText('Pushed Title');
  await expect(np.locator('.np-source')).toHaveText('demo');
  for (const name of ['Previous', 'Pause', 'Next']) await expect(np.getByRole('button', { name })).toBeVisible();
  await expect(np.locator('.art-img')).toHaveCount(0);
  await expect(np.locator('.art-placeholder')).toBeVisible();

  await demo({ type: 'position_changed', position: 42 });
  await expect(np.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^4[2-4]$/);

  await demo({ type: 'state_changed', state: 'paused' });
  await expect(np.getByRole('button', { name: 'Play' })).toBeVisible();

  await demo({ type: 'song_changed', song: null });
  await expect(np.locator('.np-title')).toHaveCount(0);
  await expect(page.locator('.player-bar .mini-source-name')).toHaveText('demo');
});

test('the bar shows title and artist and opens Now Playing', async ({ page }) => {
  await openNowPlaying(page);
  await page.getByRole('button', { name: 'Close Now Playing' }).click();
  mpc('-q', 'play', '3');
  await expect(page.locator('.player-bar .mini-title')).toHaveText('Third Silence');
  await expect(page.locator('.player-bar .mini-artist')).toHaveText('Test Artist');
  await page.locator('.bar-chevron').click();
  await expect(page.locator('.now-playing.open .np-title')).toHaveText('Third Silence');
});
