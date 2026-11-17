// Live ACR state for the UI: WebSocket events on top of a REST snapshot, reconnecting with backoff.
// Constraint: re-snapshot on every (re)connect and drop all playback state while disconnected,
// so the UI never shows a stale "playing".

import { computed, signal } from '@preact/signals';
import * as acr from '../api/acr.ts';
import { realTimers, throttle } from '../lib/timing.ts';
import { activePlayer, activeSong, EMPTY_MODEL, rebase, reduce, transport, type AcrModel } from './acr-model.ts';
import { positionAt } from './position.ts';
import * as vol from './volume.ts';

export type Connection = 'connecting' | 'online';

export const connection = signal<Connection>('connecting');
export const model = signal<AcrModel>(EMPTY_MODEL);
export const volume = signal<vol.VolumeState>(vol.initialVolume);
/** Wall clock in ms, ticking once a second while something plays (drives position interpolation). */
export const clock = signal(Date.now());

export const player = computed(() => activePlayer(model.value));
export const song = computed(() => activeSong(model.value));
export const playing = computed(() => player.value?.state === 'playing');
export const controls = computed(() => transport(player.value));
export const position = computed(() => {
  const anchor = model.value.position;
  const duration = song.value?.duration;
  return anchor ? positionAt(anchor, playing.value, duration, clock.value) : null;
});

const MAX_BACKOFF_MS = 5000;
let socket: WebSocket | null = null;
let attempt = 0;
let reconnectTimer: number | null = null;
/** One buffer per snapshot request in flight: events that arrive meanwhile are replayed on top of it. */
const buffers = new Set<acr.AcrEvent[]>();
let resyncTimer: number | null = null;

const eventsUrl = (): string => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${acr.ACR_BASE}/events`;

function applyEvent(e: acr.AcrEvent): void {
  model.value = reduce(model.value, e, Date.now());
  for (const b of buffers) b.push(e);
  if (e.type === 'volume_changed') volume.value = vol.fromServer(volume.value, true, e.percentage);
  // ACR has no active-player event and MPD no position events: re-read both after state changes.
  if (e.type === 'state_changed' && connection.value === 'online') scheduleResync();
}

async function snapshot(sock: WebSocket, withVolume: boolean): Promise<void> {
  const events: acr.AcrEvent[] = [];
  buffers.add(events);
  try {
    const [nowPlaying, players, volumeInfo] = await Promise.all([
      acr.getNowPlaying(),
      acr.getPlayers(),
      withVolume ? acr.getVolume() : Promise.resolve(model.value.volume),
    ]);
    if (socket !== sock) return;
    model.value = rebase({ nowPlaying, players }, volumeInfo, events, Date.now());
    if (withVolume) volume.value = vol.fromServer(volume.value, volumeInfo.available, volumeInfo.percentage);
    connection.value = 'online';
    attempt = 0;
  } catch {
    if (socket === sock && withVolume) sock.close();
  } finally {
    buffers.delete(events);
  }
}

function scheduleResync(): void {
  if (resyncTimer !== null) clearTimeout(resyncTimer);
  resyncTimer = window.setTimeout(() => {
    resyncTimer = null;
    if (socket) void snapshot(socket, false);
  }, 400);
}

function goOffline(): void {
  connection.value = 'connecting';
  model.value = EMPTY_MODEL;
  volume.value = vol.fromServer(volume.value, false, null);
}

function connect(): void {
  reconnectTimer = null;
  const sock = new WebSocket(eventsUrl());
  socket = sock;
  sock.onopen = () => void snapshot(sock, true);
  sock.onmessage = (msg) => {
    if (socket !== sock || typeof msg.data !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(msg.data);
    } catch {
      return;
    }
    const e = acr.parseEvent(json);
    if (e) applyEvent(e);
  };
  sock.onclose = () => {
    if (socket !== sock) return;
    socket = null;
    goOffline();
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
    attempt += 1;
    reconnectTimer = window.setTimeout(connect, delay);
  };
}

export function startAcr(): void {
  connect();
  window.setInterval(() => {
    if (playing.value) clock.value = Date.now();
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !socket && reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      attempt = 0;
      connect();
    }
  });
}

/* ---------- actions ---------- */

const ignore = (): void => undefined;

export function command(cmd: string): void {
  const name = model.value.active;
  if (name) acr.sendCommand(name, cmd).catch(ignore);
}

export const playerCommand = (name: string, cmd: string): Promise<void> => acr.sendCommand(name, cmd);

let recheck: number | null = null;
function volumeFailed(): void {
  volume.value = vol.failed(volume.value);
  if (recheck !== null) return;
  recheck = window.setTimeout(() => {
    recheck = null;
    acr
      .getVolume()
      .then((v) => (volume.value = vol.fromServer(volume.value, v.available, v.percentage)))
      .catch(ignore);
  }, 3000);
}

const volumeGate = throttle<number>((p) => acr.setVolume(p).catch(volumeFailed), 100, realTimers);

export function volumeInput(p: number): void {
  volume.value = vol.dragTo(volume.value, p);
  volumeGate.push(p);
}

export function volumeCommit(p: number): void {
  volume.value = vol.release(volume.value, p, Date.now());
  volumeGate.flush(p);
  // Re-render once the settle window ends, in case ACR never echoes the value.
  window.setTimeout(() => (clock.value = Date.now()), vol.SETTLE_MS + 50);
}

export function toggleMute(): void {
  acr.toggleMute().catch(volumeFailed);
}
