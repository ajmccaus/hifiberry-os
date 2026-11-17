// Unit tests for the pure ACR event reducer and snapshot/rebase logic.
// Constraint: event shapes are those ACR 0.25 sends (docs/dev/ACR-CONTRACT.md §5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEvent, type NowPlaying, type PlayerInfo } from '../../src/api/acr.ts';
import { activeSong, EMPTY_MODEL, fromSnapshot, rebase, reduce, transport, type AcrModel } from '../../src/state/acr-model.ts';

const MPD_STOPPED_CAPS = ['play', 'pause', 'play_pause', 'shuffle', 'loop', 'queue', 'killable'];
const mpd = (over: Partial<PlayerInfo> = {}): PlayerInfo => ({
  name: 'mpd',
  state: 'stopped',
  isActive: true,
  capabilities: MPD_STOPPED_CAPS,
  position: null,
  ...over,
});
const demo: PlayerInfo = { name: 'demo', state: 'stopped', isActive: false, capabilities: ['play', 'pause', 'next', 'previous'], position: null };
const vol = { available: true, percentage: 50 };
const np = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  player: 'mpd',
  song: { title: 'First Silence', artist: 'Test Artist', album: 'Test Album', duration: 60 },
  state: 'playing',
  position: 2,
  ...over,
});

const ev = (json: unknown) => {
  const e = parseEvent(json);
  assert.ok(e, `event parses: ${JSON.stringify(json)}`);
  return e;
};

const base = (): AcrModel => fromSnapshot({ nowPlaying: np(), players: [mpd({ state: 'playing' }), demo] }, vol, 1000);

test('snapshot seeds active player, song, position anchor and volume', () => {
  const m = base();
  assert.equal(m.active, 'mpd');
  assert.equal(activeSong(m)?.title, 'First Silence');
  assert.deepEqual(m.position, { value: 2, at: 1000 });
  assert.deepEqual(m.volume, vol);
});

test('duplicate state_changed is idempotent (same object back)', () => {
  const m = base();
  const e = ev({ type: 'state_changed', player_name: 'mpd', player_id: '127.0.0.1:6600', state: 'playing' });
  assert.equal(reduce(m, e, 2000), m);
  assert.equal(reduce(reduce(m, e, 2000), e, 3000), m);
});

test('pause freezes the interpolated position; play re-anchors it', () => {
  const paused = reduce(base(), ev({ type: 'state_changed', player_name: 'mpd', state: 'paused' }), 4000);
  assert.deepEqual(paused.position, { value: 5, at: 4000 });
  assert.equal(paused.players.find((p) => p.name === 'mpd')?.state, 'paused');
  const resumed = reduce(paused, ev({ type: 'state_changed', player_name: 'mpd', state: 'playing' }), 9000);
  assert.deepEqual(resumed.position, { value: 5, at: 9000 });
});

test('another player starting to play becomes active (ACR has no active_player_changed)', () => {
  const m = reduce(base(), ev({ type: 'state_changed', player_name: 'demo', state: 'playing' }), 2000);
  assert.equal(m.active, 'demo');
  assert.deepEqual(
    m.players.map((p) => [p.name, p.isActive]),
    [
      ['mpd', false],
      ['demo', true],
    ],
  );
  assert.equal(m.position, null);
});

test('song_changed for the active player replaces the song and restarts position; same song keeps it', () => {
  const m = base();
  const same = reduce(m, ev({ type: 'song_changed', player_name: 'mpd', song: { title: 'First Silence', artist: 'Test Artist', album: 'Test Album', duration: 60 } }), 5000);
  assert.equal(same, m);
  const next = reduce(m, ev({ type: 'song_changed', player_name: 'mpd', song: { title: 'Second Silence', artist: 'Test Artist', duration: 120 } }), 5000);
  assert.equal(activeSong(next)?.title, 'Second Silence');
  assert.deepEqual(next.position, { value: 0, at: 5000 });
  const cleared = reduce(next, ev({ type: 'song_changed', player_name: 'mpd', song: null }), 6000);
  assert.equal(activeSong(cleared), null);
});

test('song_changed of an inactive player is kept for when it becomes active', () => {
  let m = reduce(base(), ev({ type: 'song_changed', player_name: 'demo', song: { title: 'Pushed' } }), 2000);
  assert.equal(activeSong(m)?.title, 'First Silence');
  m = reduce(m, ev({ type: 'state_changed', player_name: 'demo', state: 'playing' }), 2100);
  assert.equal(activeSong(m)?.title, 'Pushed');
});

test('partial song_information_update merges only into the matching song', () => {
  const m = base();
  const art = reduce(m, ev({ type: 'song_information_update', player_name: 'mpd', song: { title: 'First Silence', cover_art_url: '/api/audiocontrol/imagecache/x.jpg' } }), 2000);
  const s = activeSong(art);
  assert.equal(s?.coverArtUrl, '/api/audiocontrol/imagecache/x.jpg');
  assert.equal(s?.album, 'Test Album', 'absent field = unchanged');
  const stale = reduce(art, ev({ type: 'song_information_update', player_name: 'mpd', song: { title: 'Other Song', album: 'X' } }), 3000);
  assert.equal(stale, art, 'update for a song no longer shown is ignored');
  const byArtist = reduce(art, ev({ type: 'song_information_update', player_name: 'mpd', song: { artist: 'Someone Else', album: 'Y' } }), 3000);
  assert.equal(byArtist, art);
});

test('capabilities_changed drives which transport buttons exist', () => {
  const stopped = fromSnapshot({ nowPlaying: np({ state: 'stopped', song: null, position: null }), players: [mpd(), demo] }, vol, 0);
  assert.deepEqual(transport(stopped.players[0]), { previous: false, next: false, toggle: 'play', toggleCommand: 'play' });
  let m = reduce(stopped, ev({ type: 'state_changed', player_name: 'mpd', state: 'playing' }), 1);
  m = reduce(m, ev({ type: 'capabilities_changed', player_name: 'mpd', capabilities: [...MPD_STOPPED_CAPS, 'stop', 'next', 'seek'] }), 2);
  assert.deepEqual(transport(m.players[0]), { previous: false, next: true, toggle: 'pause', toggleCommand: 'pause' });
  m = reduce(m, ev({ type: 'capabilities_changed', player_name: 'mpd', capabilities: [...MPD_STOPPED_CAPS, 'stop', 'next', 'previous'] }), 3);
  assert.equal(transport(m.players[0]).previous, true);
  assert.deepEqual(transport({ ...demo, capabilities: ['play_pause'], state: 'playing' }).toggleCommand, 'playpause');
  assert.deepEqual(transport({ ...demo, capabilities: ['next'] }).toggle, null);
  assert.deepEqual(transport(undefined), { previous: false, next: false, toggle: null, toggleCommand: null });
});

test('position_changed only re-anchors the active player', () => {
  const m = base();
  assert.deepEqual(reduce(m, ev({ type: 'position_changed', player_name: 'mpd', position: 42.5 }), 7000).position, { value: 42.5, at: 7000 });
  assert.equal(reduce(m, ev({ type: 'position_changed', player_name: 'demo', position: 1 }), 7000), m);
});

test('volume_changed (no player_name) updates the volume', () => {
  const m = reduce(base(), ev({ type: 'volume_changed', control_name: 'dummy', percentage: 65, decibels: -42, raw_value: 65 }), 1);
  assert.deepEqual(m.volume, { available: true, percentage: 65 });
});

test('reconnect resync: snapshot plus events received meanwhile ends in the newest state', () => {
  const snap = { nowPlaying: np(), players: [mpd({ state: 'playing' }), demo] };
  const during = [
    ev({ type: 'song_changed', player_name: 'mpd', song: { title: 'Second Silence', artist: 'Test Artist' } }),
    ev({ type: 'state_changed', player_name: 'mpd', state: 'paused' }),
  ];
  const m = rebase(snap, vol, during, 10_000);
  assert.equal(activeSong(m)?.title, 'Second Silence');
  assert.equal(m.players[0]?.state, 'paused');
  const empty = rebase({ nowPlaying: { player: null, song: null, state: 'unknown', position: null }, players: [] }, vol, [], 0);
  assert.deepEqual({ ...empty, volume: EMPTY_MODEL.volume }, EMPTY_MODEL);
});

test('an event for an unknown player adds it instead of being lost', () => {
  const m = reduce(base(), ev({ type: 'state_changed', player_name: 'librespot', state: 'paused' }), 1);
  assert.equal(m.players.find((p) => p.name === 'librespot')?.state, 'paused');
});
