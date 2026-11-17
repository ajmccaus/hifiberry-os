// Radio favorites end to end: search on a phone (radio-browser.info intercepted, no internet),
// add -> the real helper stores it -> the kiosk lists it -> a tap sends upstream's ACR sequence.
// The station is a real stream from the test stubs: MPD's "play" on an unreachable URL fails or
// succeeds depending on how fast the connection error arrives, so it cannot stand in for a station.
import { expect, HELPER, helperPut, isKiosk, KIOSK, LAN, mpc, resetAudio, STUBS, test, watch } from './fixtures.ts';

const STATION = {
  stationuuid: '9617a958-0601-11e8-ae97-52543be04c81',
  name: 'Test Jazz',
  url: `${STUBS}/stream/jazz.mp3`,
  favicon: '',
};

test.afterEach(async () => {
  await resetAudio();
  await helperPut('/radio', { stations: [] });
});

test('favorite added on a phone appears on the kiosk and plays with the ACR command sequence', async ({ browser }, info) => {
  test.skip(!isKiosk(info.project.name), 'one run per engine: the test drives both a phone and the kiosk');
  await helperPut('/radio', { stations: [] });

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, baseURL: LAN });
  const phone = await phoneCtx.newPage();
  const phoneOk = watch(phone);
  const searched: string[] = [];
  await phone.route('https://all.api.radio-browser.info/json/servers', (r) => r.fulfill({ json: [{ name: 'de1.api.radio-browser.info' }] }));
  await phone.route('https://de1.api.radio-browser.info/**', (r) => {
    searched.push(r.request().url());
    return r.request().url().includes('/json/stations/byname/') ? r.fulfill({ json: [STATION] }) : r.fulfill({ body: '' });
  });
  await phone.goto('/#/radio');
  await phone.getByRole('searchbox', { name: 'Station name' }).fill('jazz');
  await phone.keyboard.press('Enter');
  await phone.getByRole('button', { name: 'Add Test Jazz' }).click();
  await expect(phone.locator('.station.favorite')).toHaveText('Test Jazz');
  expect(searched.some((u) => u.includes('/json/stations/byname/jazz?hidebroken=true&limit=50'))).toBe(true);
  // The list updates before the helper's PUT returns, so poll the stored copy rather than race it.
  const stored = async () => ((await (await fetch(`${HELPER}/radio`)).json()) as { stations: unknown[] }).stations;
  await expect.poll(stored).toEqual([{ id: STATION.stationuuid, name: 'Test Jazz', url: STATION.url, favicon: '' }]);
  phoneOk();
  await phoneCtx.close();

  const kioskCtx = await browser.newContext({ viewport: { width: 800, height: 480 }, hasTouch: true, baseURL: KIOSK });
  const kiosk = await kioskCtx.newPage();
  const kioskOk = watch(kiosk);
  await kiosk.goto('/#/radio');
  await kiosk.getByRole('button', { name: 'Close Now Playing' }).click();
  await expect(kiosk.getByRole('searchbox')).toHaveCount(0);
  await expect(kiosk.getByText('To add stations, open')).toContainText('http://192.168.1.50/#/radio');
  const calls: { path: string; body: unknown }[] = [];
  kiosk.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (r.method() === 'POST' && path.startsWith('/api/audiocontrol/player/')) calls.push({ path, body: r.postDataJSON() });
  });
  mpc('-q', 'play', '1');
  await kiosk.getByRole('button', { name: 'Play Test Jazz' }).click();
  await expect.poll(() => calls.length).toBe(4);
  expect(calls).toEqual([
    { path: '/api/audiocontrol/player/active/command/pause', body: null },
    { path: '/api/audiocontrol/player/mpd/command/clear_queue', body: null },
    {
      path: '/api/audiocontrol/player/mpd/command/add_track',
      body: { uri: STATION.url, metadata: { title: 'Test Jazz', artist: 'Radio Station', album: 'Radio', genre: 'Radio' } },
    },
    { path: '/api/audiocontrol/player/mpd/command/play', body: null },
  ]);
  await expect.poll(() => mpc('playlist')).toContain(STATION.url);
  await expect.poll(() => mpc('status')).toContain('[playing]');

  await kiosk.getByRole('button', { name: 'Remove Test Jazz' }).click();
  await expect(kiosk.locator('.station.favorite')).toHaveCount(0);
  kioskOk();
  await kioskCtx.close();
});

test.describe('station that cannot be started', () => {
  test.use({ allowHttpStatus: [500] });

  test('ACR refusing play shows the error next to the list', async ({ page }, info) => {
    test.skip(!isKiosk(info.project.name), 'the kiosk and a LAN client share this code path');
    await helperPut('/radio', { stations: [{ id: STATION.stationuuid, name: 'Test Jazz', url: STATION.url, favicon: '' }] });
    // ACR answers 500 when MPD cannot open the stream; answered here so the outcome does not depend on timing.
    await page.route('**/api/audiocontrol/player/mpd/command/play', (r) =>
      r.fulfill({ status: 500, json: { success: false, message: "Failed to send command 'play' to player with name: mpd" } }),
    );
    await page.goto('/#/radio');
    await page.getByRole('button', { name: 'Close Now Playing' }).click();
    await page.getByRole('button', { name: 'Play Test Jazz' }).click();
    await expect(page.getByRole('alert')).toHaveText('Test Jazz could not be started.');
  });
});
