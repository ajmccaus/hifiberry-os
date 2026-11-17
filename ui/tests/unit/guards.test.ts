// Unit tests for the boundary type guards: malformed or hostile network JSON never gets through.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEvent, parseNowPlaying, parsePlayers, parseSong, parseVolumeInfo } from '../../src/api/acr.ts';
import { parseNetwork, parseSystemInfo } from '../../src/api/config.ts';
import { parseScreen, parseStations, toStation } from '../../src/api/device.ts';
import { safeImageUrl } from '../../src/api/guards.ts';
import { parseSearch } from '../../src/api/radio-browser.ts';

test('image URLs: only http(s) or host-relative paths', () => {
  assert.equal(safeImageUrl('/api/audiocontrol/library/mpd/image/abc'), '/api/audiocontrol/library/mpd/image/abc');
  assert.equal(safeImageUrl('https://lastfm.example/a.jpg'), 'https://lastfm.example/a.jpg');
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//evil.example/x.png', 'file:///etc/passwd', '', 42, null, 'x'.repeat(2001)]) {
    assert.equal(safeImageUrl(bad), undefined, String(bad));
  }
});

test('songs keep only well-typed fields; cover art falls back to radio logo metadata', () => {
  assert.deepEqual(parseSong({ title: 7, artist: 'A', duration: 'x', cover_art_url: 'javascript:x' }), { artist: 'A' });
  assert.equal(parseSong({ metadata: { coverart_url: 'http://radio.example/logo.png' } })?.coverArtUrl, 'http://radio.example/logo.png');
  assert.equal(parseSong(null), null);
  assert.equal(parseSong([]), null);
});

test('events: lowercase-normalised states, volume without player, unknown types dropped', () => {
  assert.deepEqual(parseEvent({ type: 'state_changed', player_name: 'mpd', state: 'Playing' }), { type: 'state_changed', player: 'mpd', state: 'playing' });
  assert.deepEqual(parseEvent({ type: 'state_changed', player_name: 'mpd', state: 'weird' }), { type: 'state_changed', player: 'mpd', state: 'unknown' });
  assert.deepEqual(parseEvent({ type: 'volume_changed', percentage: 12.5, source: { player_name: null } }), { type: 'volume_changed', percentage: 12.5 });
  assert.equal(parseEvent({ type: 'volume_changed' }), null);
  assert.equal(parseEvent({ type: 'welcome', client_id: 1 }), null);
  assert.equal(parseEvent({ type: 'queue_changed', player_name: 'mpd' }), null);
  assert.equal(parseEvent({ type: 'state_changed', state: 'playing' }), null, 'needs top-level player_name');
  assert.equal(parseEvent({ type: 'capabilities_changed', player_name: 'mpd', capabilities: 'play' }), null);
  assert.equal(parseEvent({ type: 'position_changed', player_name: 'mpd', position: Number.NaN }), null);
  assert.equal(parseEvent('{"type":"state_changed"}'), null);
});

test('players and now-playing: "none" means no active player', () => {
  assert.deepEqual(parsePlayers({ players: [{ name: 'mpd', state: 'stopped', is_active: true, capabilities: ['play', 3] }, { id: 'x' }, 'junk'] }), [
    { name: 'mpd', state: 'stopped', isActive: true, capabilities: ['play'], position: null },
  ]);
  assert.deepEqual(parsePlayers({ players: 'nope' }), []);
  assert.deepEqual(parseNowPlaying({ player: { name: 'none' }, song: null, state: 'unknown' }), { player: null, song: null, state: 'unknown', position: null });
});

test('volume info: unavailable control is never reported as 0', () => {
  assert.deepEqual(parseVolumeInfo({ available: false, control_info: null, current_state: null }), { available: false, percentage: null });
  assert.deepEqual(parseVolumeInfo({ available: true, current_state: { percentage: 40 } }), { available: true, percentage: 40 });
  assert.deepEqual(parseVolumeInfo({ available: true }), { available: false, percentage: null });
});

test('helper screen and stations are validated like the helper validates them', () => {
  assert.deepEqual(parseScreen({ available: true, brightness: 60, timeout: 300 }), { available: true, brightness: 60, timeout: 300 });
  assert.equal(parseScreen({ available: true, brightness: '60' }).available, false);
  const stations = parseStations({
    stations: [
      { id: '1', name: 'Good', url: 'https://stream.example/a', favicon: 'https://img.example/a.png' },
      { id: '2', name: 'Bad scheme', url: 'ftp://x' },
      { id: '3', name: 'Bad logo', url: 'http://stream.example/b', favicon: 'javascript:alert(1)' },
      null,
    ],
  });
  assert.deepEqual(stations.map((s) => [s.id, s.favicon]), [
    ['1', 'https://img.example/a.png'],
    ['3', ''],
  ]);
  assert.equal(toStation({ url: 'https://s.example/', name: 'n'.repeat(500) })?.name.length, 200);
});

test('radio-browser results map to stations and skip unusable entries', () => {
  const r = parseSearch([
    { stationuuid: 'u1', name: ' Jazz FM ', url: 'http://jazz.example/stream', favicon: 'https://jazz.example/i.png' },
    { stationuuid: 'u2', name: 'No URL' },
    { stationuuid: 'u3', name: '<img src=x onerror=alert(1)>', url: 'https://x.example/s', favicon: '' },
  ]);
  assert.deepEqual(r, [
    { id: 'u1', name: 'Jazz FM', url: 'http://jazz.example/stream', favicon: 'https://jazz.example/i.png' },
    { id: 'u3', name: '<img src=x onerror=alert(1)>', url: 'https://x.example/s', favicon: '' },
  ]);
  assert.deepEqual(parseSearch({ error: 'x' }), []);
});

test('configurator shapes: names, models and IPv4 interfaces', () => {
  const info = parseSystemInfo({
    pi_model: { name: 'Raspberry Pi 4 Model B' },
    soundcard: { name: 'unknown' },
    hat_info: { product: 'Amp2' },
    system: { hostname: 'livingroom', pretty_hostname: '' },
  });
  assert.deepEqual(info, { name: 'livingroom', hostname: 'livingroom', model: 'Raspberry Pi 4 Model B', soundcard: 'Amp2' });
  const net = parseNetwork({
    status: 'success',
    data: { hostname: 'livingroom', interfaces: [{ name: 'eth0', ipv4: '10.0.0.5', type: 'wired' }, { name: 'wlan0', ipv4: null }, { name: 'x', ipv4: 'evil' }] },
  });
  assert.deepEqual(net, { hostname: 'livingroom', interfaces: [{ name: 'eth0', ipv4: '10.0.0.5', type: 'wired' }] });
  assert.deepEqual(parseNetwork({ status: 'error' }), { hostname: null, interfaces: [] });
});
