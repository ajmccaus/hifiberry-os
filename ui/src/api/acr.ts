// Audio controller (ACR 0.25) client: REST calls and event parsing, validated at the boundary.
// Constraint: wire facts follow scratchpad ACR-CONTRACT (lowercase states, no set-active endpoint,
// volume failures are HTTP 200 success:false, cover-art paths already carry the proxy prefix).

import { bool, isHttpUrl, isRecord, num, rec, records, safeImageUrl, str, strings, type Json } from './guards.ts';
import { HttpError, request } from './http.ts';

export const ACR_BASE = '/api/audiocontrol';

export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'killed' | 'disconnected' | 'unknown';

export interface Song {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverArtUrl?: string;
  streamUrl?: string;
}

export interface PlayerInfo {
  name: string;
  state: PlaybackState;
  isActive: boolean;
  capabilities: string[];
  position: number | null;
}

export interface NowPlaying {
  player: string | null;
  song: Song | null;
  state: PlaybackState;
  position: number | null;
}

export interface VolumeInfo {
  available: boolean;
  percentage: number | null;
}

export type AcrEvent =
  | { type: 'state_changed'; player: string; state: PlaybackState }
  | { type: 'song_changed'; player: string; song: Song | null }
  | { type: 'song_information_update'; player: string; song: Song }
  | { type: 'position_changed'; player: string; position: number }
  | { type: 'capabilities_changed'; player: string; capabilities: string[] }
  | { type: 'volume_changed'; percentage: number };

const STATES: readonly PlaybackState[] = ['playing', 'paused', 'stopped', 'killed', 'disconnected', 'unknown'];

export const parseState = (v: unknown): PlaybackState => {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return STATES.find((x) => x === s) ?? 'unknown';
};

/** Only the fields present and well-typed are set (partial updates rely on that). */
export function parseSong(v: unknown): Song | null {
  if (!isRecord(v)) return null;
  const song: Song = {};
  const title = str(v, 'title');
  const artist = str(v, 'artist');
  const album = str(v, 'album');
  const duration = num(v, 'duration');
  const streamUrl = str(v, 'stream_url');
  const meta = rec(v, 'metadata') ?? {};
  const cover = safeImageUrl(v['cover_art_url']) ?? safeImageUrl(meta['coverart_url']) ?? safeImageUrl(meta['logo_url']);
  if (title !== undefined) song.title = title;
  if (artist !== undefined) song.artist = artist;
  if (album !== undefined) song.album = album;
  if (duration !== undefined && duration > 0) song.duration = duration;
  if (cover !== undefined) song.coverArtUrl = cover;
  if (streamUrl !== undefined) song.streamUrl = streamUrl;
  return song;
}

export function parsePlayer(v: Json): PlayerInfo | null {
  const name = str(v, 'name');
  if (!name || name === 'none') return null;
  return {
    name,
    state: parseState(v['state']),
    isActive: bool(v, 'is_active') ?? false,
    capabilities: strings(v, 'capabilities') ?? [],
    position: num(v, 'position') ?? null,
  };
}

export function parsePlayers(v: unknown): PlayerInfo[] {
  if (!isRecord(v)) return [];
  return records(v, 'players')
    .map(parsePlayer)
    .filter((p): p is PlayerInfo => p !== null);
}

export function parseNowPlaying(v: unknown): NowPlaying {
  const o = isRecord(v) ? v : {};
  const player = rec(o, 'player');
  const name = player ? str(player, 'name') : undefined;
  return {
    player: name && name !== 'none' ? name : null,
    song: parseSong(o['song']),
    state: parseState(o['state']),
    position: num(o, 'position') ?? null,
  };
}

export function parseVolumeInfo(v: unknown): VolumeInfo {
  const o = isRecord(v) ? v : {};
  const current = rec(o, 'current_state');
  const percentage = current ? num(current, 'percentage') : undefined;
  return { available: bool(o, 'available') === true && percentage !== undefined, percentage: percentage ?? null };
}

export function parseEvent(v: unknown): AcrEvent | null {
  if (!isRecord(v)) return null;
  const type = str(v, 'type');
  const player = str(v, 'player_name');
  if (type === 'volume_changed') {
    const percentage = num(v, 'percentage');
    return percentage === undefined ? null : { type, percentage };
  }
  if (!player) return null;
  switch (type) {
    case 'state_changed':
      return { type, player, state: parseState(v['state']) };
    case 'song_changed':
      return { type, player, song: parseSong(v['song']) };
    case 'song_information_update': {
      const song = parseSong(v['song']);
      return song ? { type, player, song } : null;
    }
    case 'position_changed': {
      const position = num(v, 'position');
      return position === undefined ? null : { type, player, position };
    }
    case 'capabilities_changed': {
      const capabilities = strings(v, 'capabilities');
      return capabilities ? { type, player, capabilities } : null;
    }
    default:
      return null;
  }
}

export const getPlayers = async (): Promise<PlayerInfo[]> => parsePlayers(await request(`${ACR_BASE}/players`));
export const getNowPlaying = async (): Promise<NowPlaying> => parseNowPlaying(await request(`${ACR_BASE}/now-playing`));
export const getVolume = async (): Promise<VolumeInfo> => parseVolumeInfo(await request(`${ACR_BASE}/volume/info`));

const commandUrl = (player: string, command: string): string =>
  `${ACR_BASE}/player/${encodeURIComponent(player)}/command/${command}`;

export async function sendCommand(player: string, command: string, body?: unknown): Promise<void> {
  await request(commandUrl(player, command), { method: 'POST', body });
}

/** Volume POSTs answer HTTP 200 even on failure; success:false becomes an error here. */
async function volumePost(path: string, body?: unknown): Promise<number> {
  const res = await request(`${ACR_BASE}/volume/${path}`, { method: 'POST', body });
  const state = isRecord(res) && res['success'] === true ? rec(res, 'new_state') : undefined;
  const percentage = state ? num(state, 'percentage') : undefined;
  if (percentage === undefined) throw new HttpError(200, `volume ${path} refused`);
  return percentage;
}

export const setVolume = (percentage: number): Promise<number> =>
  volumePost('set', { percentage: Math.round(Math.min(100, Math.max(0, percentage))) });

export const toggleMute = (): Promise<number> => volumePost('mute');

/** First stream URL of an .m3u playlist via ACR's parser; the input URL when parsing fails. */
export async function resolveM3u(url: string): Promise<string> {
  try {
    const res = await request(`${ACR_BASE}/m3u/parse`, { method: 'POST', body: { url, timeout: 30 }, timeoutMs: 35000 });
    const playlist = isRecord(res) && res['success'] === true ? rec(res, 'playlist') : undefined;
    const first = playlist ? records(playlist, 'entries')[0] : undefined;
    const stream = first ? str(first, 'url') : undefined;
    return stream && isHttpUrl(stream) ? stream : url;
  } catch {
    return url;
  }
}
