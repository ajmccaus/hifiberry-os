// Device-helper and configurator state: screen settings, radio favorites, system facts.
// Constraint: each backend fails on its own; a failure here only marks its own screen, never the app.

import { effect, signal } from '@preact/signals';
import * as acr from '../api/acr.ts';
import { connection } from './acr-store.ts';
import * as config from '../api/config.ts';
import * as device from '../api/device.ts';
import { debounce } from '../lib/timing.ts';
import { RADIO_PLAYER } from '../lib/sources.ts';

export type Loadable<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error' };

export const screenSettings = signal<Loadable<device.ScreenSettings>>({ status: 'loading' });
export const stations = signal<Loadable<device.Station[]>>({ status: 'loading' });
export const systemInfo = signal<Loadable<config.SystemInfo>>({ status: 'loading' });
export const network = signal<Loadable<config.NetworkInfo>>({ status: 'loading' });
export const version = signal<Loadable<string | null>>({ status: 'loading' });

async function load<T>(target: { value: Loadable<T> }, fetcher: () => Promise<T>): Promise<void> {
  try {
    target.value = { status: 'ready', value: await fetcher() };
  } catch {
    if (target.value.status !== 'ready') target.value = { status: 'error' };
  }
}

export const loadScreen = (): Promise<void> => load(screenSettings, device.getScreen);
export const loadStations = (): Promise<void> => load(stations, device.getStations);
export const loadSystem = (): Promise<void> =>
  Promise.all([load(systemInfo, config.getSystemInfo), load(network, config.getNetwork), load(version, device.getVersion)]).then(
    () => undefined,
  );

/** The address a phone should open: first IPv4, else the host name on mDNS. */
export function deviceAddress(): string | null {
  const net = network.value.status === 'ready' ? network.value.value : null;
  const ip = net?.interfaces[0]?.ipv4;
  if (ip) return ip;
  return net?.hostname ? `${net.hostname}.local` : null;
}

/* ---------- screen ---------- */

let screenSeq = 0;
/** A reply is applied only if nothing changed locally since its request: no jumping back mid-drag. */
const putScreen = (change: { brightness?: number; timeout?: number }): void => {
  const seq = ++screenSeq;
  device
    .putScreen(change)
    .then((value) => {
      if (seq === screenSeq) screenSettings.value = { status: 'ready', value };
    })
    .catch(() => {
      if (seq === screenSeq) void loadScreen();
    });
};

const brightnessGate = debounce<number>((brightness) => putScreen({ brightness }), 300);

const setLocalScreen = (change: Partial<device.ScreenSettings>): void => {
  screenSeq += 1;
  const s = screenSettings.value;
  if (s.status === 'ready') screenSettings.value = { status: 'ready', value: { ...s.value, ...change } };
};

export function brightnessInput(percent: number): void {
  const brightness = Math.max(1, Math.round(percent));
  setLocalScreen({ brightness });
  brightnessGate.push(brightness);
}

export function brightnessCommit(percent: number): void {
  const brightness = Math.max(1, Math.round(percent));
  setLocalScreen({ brightness });
  brightnessGate.flush(brightness);
}

export function setScreenTimeout(timeout: number): void {
  setLocalScreen({ timeout });
  putScreen({ timeout });
}

/* ---------- radio ---------- */

export const radioError = signal<string | null>(null);

async function saveStations(next: device.Station[]): Promise<void> {
  const before = stations.value;
  stations.value = { status: 'ready', value: next };
  try {
    stations.value = { status: 'ready', value: await device.putStations(next) };
    radioError.value = null;
  } catch {
    stations.value = before;
    radioError.value = 'Favorites could not be saved.';
  }
}

const currentStations = (): device.Station[] => (stations.value.status === 'ready' ? stations.value.value : []);

export function addStation(station: device.Station): Promise<void> {
  const list = currentStations();
  if (list.some((s) => s.url === station.url) || list.length >= device.MAX_STATIONS) return Promise.resolve();
  return saveStations([...list, station]);
}

export const removeStation = (id: string): Promise<void> => saveStations(currentStations().filter((s) => s.id !== id));

/** Upstream's sequence: optional m3u resolve, pause current, clear the radio player's queue, add, play. */
export async function playStation(station: device.Station): Promise<void> {
  try {
    const url = station.url.toLowerCase().endsWith('.m3u') ? await acr.resolveM3u(station.url) : station.url;
    await acr.sendCommand('active', 'pause').catch(() => undefined);
    await acr.sendCommand(RADIO_PLAYER, 'clear_queue');
    const metadata: Record<string, string> = { title: station.name, artist: 'Radio Station', album: 'Radio', genre: 'Radio' };
    if (station.favicon) metadata['coverart_url'] = station.favicon;
    await acr.sendCommand(RADIO_PLAYER, 'add_track', { uri: url, metadata });
    await acr.sendCommand(RADIO_PLAYER, 'play');
    radioError.value = null;
  } catch {
    radioError.value = `${station.name} could not be started.`;
  }
}

/* ---------- power ---------- */

export type PowerAction = 'restart' | 'shutdown';
/** Set once the helper accepted a power request; cleared when the device is back. */
export const powerState = signal<{ action: PowerAction; wentDown: boolean } | null>(null);

export async function requestPower(action: PowerAction): Promise<boolean> {
  try {
    await device.power(action);
    powerState.value = { action, wentDown: false };
    return true;
  } catch {
    return false;
  }
}

/** The audio service drops while the device restarts; its return ends the overlay. */
export function startPowerWatch(): void {
  effect(() => {
    const p = powerState.value;
    const online = connection.value === 'online';
    if (!p) return;
    if (!online && !p.wentDown) powerState.value = { ...p, wentDown: true };
    else if (online && p.wentDown) powerState.value = null;
  });
}
