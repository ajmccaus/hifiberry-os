// Configurator client (/api/config/v1): read-only system and network facts for the System screen.
// Constraint: shapes follow configurator 2.19 source (systeminfo.py get_system_info_dict, network.py).

import { isRecord, rec, records, str } from './guards.ts';
import { request } from './http.ts';

const BASE = '/api/config/v1';

export interface SystemInfo {
  name: string | null;
  hostname: string | null;
  model: string | null;
  soundcard: string | null;
}

export interface NetworkInterface {
  name: string;
  ipv4: string;
  type: 'wired' | 'wireless';
}

export interface NetworkInfo {
  hostname: string | null;
  interfaces: NetworkInterface[];
}

const known = (v: string | undefined): string | null => (v && v.trim() && v !== 'unknown' ? v.trim() : null);

export function parseSystemInfo(v: unknown): SystemInfo {
  const o = isRecord(v) ? v : {};
  const system = rec(o, 'system') ?? {};
  const pi = rec(o, 'pi_model') ?? {};
  const card = rec(o, 'soundcard') ?? {};
  const hat = rec(o, 'hat_info') ?? {};
  return {
    name: known(str(system, 'pretty_hostname')) ?? known(str(system, 'hostname')),
    hostname: known(str(system, 'hostname')),
    model: known(str(pi, 'name')),
    soundcard: known(str(card, 'name')) ?? known(str(hat, 'product')),
  };
}

/** GET /network answers {status, data:{hostname, interfaces[]}}; only interfaces with an IPv4 count. */
export function parseNetwork(v: unknown): NetworkInfo {
  const data = isRecord(v) ? (rec(v, 'data') ?? {}) : {};
  const interfaces: NetworkInterface[] = [];
  for (const i of records(data, 'interfaces')) {
    const name = str(i, 'name');
    const ipv4 = str(i, 'ipv4');
    if (!name || !ipv4 || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4)) continue;
    interfaces.push({ name, ipv4, type: str(i, 'type') === 'wireless' ? 'wireless' : 'wired' });
  }
  return { hostname: known(str(data, 'hostname')), interfaces };
}

export const getSystemInfo = async (): Promise<SystemInfo> => parseSystemInfo(await request(`${BASE}/systeminfo`));
export const getNetwork = async (): Promise<NetworkInfo> => parseNetwork(await request(`${BASE}/network`));
