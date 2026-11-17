// Pure model of the audio controller: REST snapshot + WebSocket events -> what the UI shows.
// Constraint: no I/O and no clock reads here (time is passed in), so every transition is unit-tested.

import type { AcrEvent, NowPlaying, PlaybackState, PlayerInfo, Song, VolumeInfo } from '../api/acr.ts';
import { positionAt, type PositionAnchor } from './position.ts';

export interface AcrModel {
  players: PlayerInfo[];
  active: string | null;
  /** Last song seen per player; the active player's entry is what Now Playing shows. */
  songs: Record<string, Song | null>;
  /** Active player's position at a moment in time (seconds at ms timestamp). */
  position: PositionAnchor | null;
  volume: VolumeInfo;
}

export const EMPTY_MODEL: AcrModel = {
  players: [],
  active: null,
  songs: {},
  position: null,
  volume: { available: false, percentage: null },
};

export interface Snapshot {
  nowPlaying: NowPlaying;
  players: PlayerInfo[];
}

export function fromSnapshot(snap: Snapshot, volume: VolumeInfo, now: number): AcrModel {
  const active = snap.nowPlaying.player ?? snap.players.find((p) => p.isActive)?.name ?? null;
  const players = snap.players.map((p) => ({ ...p, isActive: p.name === active }));
  const songs: Record<string, Song | null> = {};
  if (active) songs[active] = snap.nowPlaying.song;
  const pos = snap.nowPlaying.position;
  return { players, active, songs, position: active && pos !== null ? { value: pos, at: now } : null, volume };
}

/** Snapshot taken while events kept arriving: replaying them in order yields the newest state. */
export const rebase = (snap: Snapshot, volume: VolumeInfo, events: readonly AcrEvent[], now: number): AcrModel =>
  events.reduce((m, e) => reduce(m, e, now), fromSnapshot(snap, volume, now));

const sameSong = (a: Song | null | undefined, b: Song | null): boolean =>
  !!a && !!b && a.title === b.title && a.artist === b.artist && a.album === b.album && a.streamUrl === b.streamUrl;

const withPlayer = (m: AcrModel, name: string, change: (p: PlayerInfo) => PlayerInfo): PlayerInfo[] => {
  const known = m.players.some((p) => p.name === name);
  const base = known
    ? m.players
    : [...m.players, { name, state: 'unknown' as PlaybackState, isActive: false, capabilities: [], position: null }];
  return base.map((p) => (p.name === name ? change(p) : p));
};

export function reduce(m: AcrModel, e: AcrEvent, now: number): AcrModel {
  switch (e.type) {
    case 'state_changed': {
      const prev = m.players.find((p) => p.name === e.player);
      if (prev?.state === e.state && (e.state !== 'playing' || m.active === e.player)) return m;
      const becomesActive = e.state === 'playing' && m.active !== e.player;
      const active = becomesActive ? e.player : m.active;
      const players = withPlayer(m, e.player, (p) => ({ ...p, state: e.state })).map((p) => ({
        ...p,
        isActive: p.name === active,
      }));
      let position = m.position;
      if (becomesActive) position = null;
      else if (e.player === active && position) {
        const wasPlaying = prev?.state === 'playing';
        position = { value: positionAt(position, wasPlaying, undefined, now), at: now };
      }
      return { ...m, players, active, position };
    }
    case 'song_changed': {
      const current = m.songs[e.player];
      if (sameSong(current, e.song)) return m;
      const songs = { ...m.songs, [e.player]: e.song };
      const position = e.player === m.active ? (e.song ? { value: 0, at: now } : null) : m.position;
      return { ...m, songs, position };
    }
    case 'song_information_update': {
      const current = m.songs[e.player];
      if (!current) return m;
      const { title, artist } = e.song;
      if (title !== undefined && current.title !== undefined && title !== current.title) return m;
      if (artist !== undefined && current.artist !== undefined && artist !== current.artist) return m;
      return { ...m, songs: { ...m.songs, [e.player]: { ...current, ...e.song } } };
    }
    case 'position_changed':
      return e.player === m.active ? { ...m, position: { value: e.position, at: now } } : m;
    case 'capabilities_changed':
      return { ...m, players: withPlayer(m, e.player, (p) => ({ ...p, capabilities: e.capabilities })) };
    case 'volume_changed':
      return { ...m, volume: { available: true, percentage: e.percentage } };
  }
}

export const activePlayer = (m: AcrModel): PlayerInfo | undefined => m.players.find((p) => p.name === m.active);

export const activeSong = (m: AcrModel): Song | null => (m.active ? (m.songs[m.active] ?? null) : null);

export interface Transport {
  previous: boolean;
  next: boolean;
  /** What the center button shows, null when the player cannot do it now. */
  toggle: 'play' | 'pause' | null;
  /** ACR command the center button sends. */
  toggleCommand: 'play' | 'pause' | 'playpause' | null;
}

export function transport(player: PlayerInfo | undefined): Transport {
  if (!player) return { previous: false, next: false, toggle: null, toggleCommand: null };
  const caps = new Set(player.capabilities);
  const playing = player.state === 'playing';
  let toggle: Transport['toggle'] = null;
  let toggleCommand: Transport['toggleCommand'] = null;
  if (playing && (caps.has('pause') || caps.has('play_pause'))) {
    toggle = 'pause';
    toggleCommand = caps.has('pause') ? 'pause' : 'playpause';
  } else if (!playing && (caps.has('play') || caps.has('play_pause'))) {
    toggle = 'play';
    toggleCommand = caps.has('play') ? 'play' : 'playpause';
  }
  return { previous: caps.has('previous'), next: caps.has('next'), toggle, toggleCommand };
}
