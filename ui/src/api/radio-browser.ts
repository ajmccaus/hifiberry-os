// radio-browser.info station search, called from the browser exactly like upstream's UI
// (hbos-ui src/stores/radio.ts): cached server, else a random one from all.api, else de2.
// Constraint: the only cross-origin requests the UI makes; never issued at page load.

import { isRecord, str } from './guards.ts';
import { toStation, type Station } from './device.ts';

const STORAGE_KEY = 'radioBrowserBaseUrl';
const FALLBACK = 'https://de2.api.radio-browser.info';
const SERVER_NAME = /^[a-z0-9.-]+\.api\.radio-browser\.info$/;

let baseUrl: string | null = null;

const readStored = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const store = (url: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    /* private mode: discover again next time */
  }
};

async function discover(): Promise<string> {
  const stored = readStored();
  if (stored && SERVER_NAME.test(stored.replace(/^https:\/\//, ''))) {
    try {
      if ((await fetch(stored)).ok) return stored;
    } catch {
      /* stored server gone: pick another */
    }
  }
  try {
    const res = await fetch('https://all.api.radio-browser.info/json/servers');
    const servers: unknown = await res.json();
    const names = Array.isArray(servers)
      ? servers.flatMap((s) => (isRecord(s) && SERVER_NAME.test(str(s, 'name') ?? '') ? [str(s, 'name') ?? ''] : []))
      : [];
    const pick = names[Math.floor(Math.random() * names.length)];
    if (pick) {
      const url = `https://${pick}`;
      store(url);
      return url;
    }
  } catch {
    /* fall through */
  }
  return FALLBACK;
}

export function parseSearch(v: unknown): Station[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s) => {
    if (!isRecord(s)) return [];
    const station = toStation({ id: str(s, 'stationuuid'), name: str(s, 'name'), url: str(s, 'url'), favicon: str(s, 'favicon') });
    return station ? [station] : [];
  });
}

export async function searchStations(query: string): Promise<Station[]> {
  const q = query.trim();
  if (!q) return [];
  baseUrl ??= await discover();
  const res = await fetch(`${baseUrl}/json/stations/byname/${encodeURIComponent(q)}?hidebroken=true&limit=50`);
  if (!res.ok) throw new Error(`radio-browser search failed: ${res.status}`);
  return parseSearch(await res.json());
}
