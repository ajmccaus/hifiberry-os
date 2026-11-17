// Device helper client (/api/device/v1): screen, radio favorites, power, version.
// Constraint: request/response shapes are the helper contract in FACTS "Device helper API".

import { bool, isHttpUrl, isRecord, num, records, str } from './guards.ts';
import { request } from './http.ts';

const BASE = '/api/device/v1';

export interface ScreenSettings {
  available: boolean;
  brightness: number;
  timeout: number;
}

export interface Station {
  id: string;
  name: string;
  url: string;
  favicon: string;
}

/** Field caps match the helper's validation so a PUT is never refused for length. */
export const STATION_LIMITS = { id: 200, name: 200, url: 2000, favicon: 2000 } as const;
export const MAX_STATIONS = 200;

export function parseScreen(v: unknown): ScreenSettings {
  const o = isRecord(v) ? v : {};
  const brightness = num(o, 'brightness');
  const timeout = num(o, 'timeout');
  return {
    available: bool(o, 'available') === true && brightness !== undefined && timeout !== undefined,
    brightness: brightness ?? 0,
    timeout: timeout ?? 0,
  };
}

/** A station is kept only when it would pass the helper's own checks. */
export function toStation(v: unknown): Station | null {
  if (!isRecord(v)) return null;
  const url = str(v, 'url');
  if (!url || url.length > STATION_LIMITS.url || !isHttpUrl(url)) return null;
  const favicon = str(v, 'favicon') ?? '';
  return {
    id: (str(v, 'id') ?? url).slice(0, STATION_LIMITS.id),
    name: (str(v, 'name') ?? url).trim().slice(0, STATION_LIMITS.name),
    url,
    favicon: favicon.length <= STATION_LIMITS.favicon && isHttpUrl(favicon) ? favicon : '',
  };
}

export function parseStations(v: unknown): Station[] {
  if (!isRecord(v)) return [];
  return records(v, 'stations')
    .map(toStation)
    .filter((s): s is Station => s !== null);
}

export const getScreen = async (): Promise<ScreenSettings> => parseScreen(await request(`${BASE}/screen`));

export const putScreen = async (change: { brightness?: number; timeout?: number }): Promise<ScreenSettings> =>
  parseScreen(await request(`${BASE}/screen`, { method: 'PUT', body: change }));

export const getStations = async (): Promise<Station[]> => parseStations(await request(`${BASE}/radio`));

export const putStations = async (stations: Station[]): Promise<Station[]> =>
  parseStations(await request(`${BASE}/radio`, { method: 'PUT', body: { stations: stations.slice(0, MAX_STATIONS) } }));

export async function power(action: 'restart' | 'shutdown'): Promise<void> {
  await request(`${BASE}/power`, { method: 'POST', body: { action } });
}

export async function getVersion(): Promise<string | null> {
  const res = await request(`${BASE}/info`);
  return isRecord(res) ? (str(res, 'version') ?? null) : null;
}
