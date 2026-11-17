// Test stubs for what cannot run here: configurator GETs (shapes from configurator 2.19 source) and
// hifiberry-auth (verify/set-password/login/csrf ported from hifiberry_auth/server.py + manifests.py).
// Constraint: same decision matrix as the real service; loopback only; test controls under /__test/.

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = Number(process.env.STUBS_PORT ?? 1191);
const AUTH_D = new URL('./auth.d/', import.meta.url).pathname;

/* ---------- tier map (manifests.py) ---------- */

const manifests = readdirSync(AUTH_D)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(AUTH_D, f), 'utf8')))
  .sort((a, b) => b.match_prefix.replace(/\/$/, '').length - a.match_prefix.replace(/\/$/, '').length);

const segments = (p) => p.split('?')[0].split('#')[0].split('/').filter(Boolean);
const glob = (pattern, s) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(s);

function pathMatches(pattern, path) {
  const pat = segments(pattern);
  const seg = segments(path);
  for (let i = 0; i < pat.length; i++) {
    if (pat[i] === '**') return true;
    if (i >= seg.length || !glob(pat[i], seg[i])) return false;
  }
  return pat.length === seg.length;
}

function tier(method, uri) {
  const path = uri.split('?')[0];
  for (const m of manifests) {
    const prefix = m.match_prefix.replace(/\/$/, '');
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    const rest = path.slice(prefix.length) || '/';
    for (const rule of m.rules ?? []) {
      const methods = (rule.methods ?? ['*']).map((x) => x.toUpperCase());
      if (!methods.includes('*') && !methods.includes(method.toUpperCase())) continue;
      if ((rule.paths ?? []).some((p) => pathMatches(p, rest))) return rule.tier === 'ok' ? 'ok' : 'risky';
    }
    return m.default_tier === 'ok' ? 'ok' : 'risky';
  }
  return 'risky';
}

/* ---------- auth state (server.py) ---------- */

let protection = 'unset';
let password = null;
const sessions = new Map(); // sid -> csrf
let configDown = false;

const sessionOf = (req) => {
  const m = /(?:^|;\s*)hifiberry_session=([^;]+)/.exec(req.headers.cookie ?? '');
  return m && sessions.has(m[1]) ? { sid: m[1], csrf: sessions.get(m[1]) } : null;
};

function decide(method, t, session, csrf) {
  if (t === 'ok' && protection !== 'all') return [null, 200];
  if (t === 'risky' && protection === 'off') return [null, 200];
  if (t === 'risky' && protection === 'unset') return ['set-password', 401];
  if (!session) return ['login', 401];
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) && csrf !== session.csrf) return ['login', 401];
  return [null, 200];
}

function authed(res) {
  const sid = randomBytes(16).toString('hex');
  const csrf = randomBytes(32).toString('base64url');
  sessions.set(sid, csrf);
  res.setHeader('Set-Cookie', `hifiberry_session=${sid}; HttpOnly; SameSite=Lax; Path=/`);
  return json(res, 200, { status: 'success', csrf });
}

/* ---------- configurator (systeminfo.py / network.py shapes) ---------- */

const systeminfo = {
  pi_model: { name: 'Raspberry Pi 4 Model B Rev 1.5', version: '4', memory: { total_kb: 1897000, total_mb: 1852, total_gb: 1.81 } },
  hat_info: { vendor: 'HiFiBerry', product: 'Amp2', uuid: null, vendor_card: 'HiFiBerry:Amp2' },
  soundcard: {
    name: 'DAC+/Amp2', volume_control: 'Digital', headphone_volume_control: null, hardware_index: 0,
    output_channels: 2, input_channels: 0, features: ['volcontrol'], hat_name: 'Amp2', supports_dsp: false,
    card_type: ['DAC', 'Amp'], fixedInConfigTxt: true, pinSource: null,
  },
  bluetooth: { available: false, audio_ready: false, adapter: null, devices: [], issues: [] },
  system: { uuid: 'test', hostname: 'livingroom', pretty_hostname: 'Living Room' },
  status: 'success',
};

const network = {
  status: 'success',
  data: {
    hostname: 'livingroom',
    default_gateway: '192.168.1.1',
    dns_servers: ['192.168.1.1'],
    interfaces: [
      { name: 'eth0', mac: 'dc:a6:32:00:00:01', ipv4: '192.168.1.50', netmask: '255.255.255.0', state: 'up', type: 'wired' },
      { name: 'wlan0', mac: 'dc:a6:32:00:00:02', ipv4: null, netmask: null, state: 'down', type: 'wireless' },
    ],
  },
};

/* ---------- http ---------- */

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

createServer(async (req, res) => {
  const url = req.url ?? '/';
  const path = url.split('?')[0];
  if (path === '/_auth/verify') {
    const method = req.headers['x-original-method'] ?? 'GET';
    const [hint, status] = decide(String(method), tier(String(method), String(req.headers['x-original-uri'] ?? '/')), sessionOf(req), req.headers['x-csrf-token']);
    if (hint) res.setHeader('WWW-Authenticate-Hint', hint);
    res.writeHead(status);
    return res.end();
  }
  if (path === '/api/auth/status') return json(res, 200, { protection, has_password: password !== null, authenticated: sessionOf(req) !== null });
  if (path === '/api/auth/set-password' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.password) return json(res, 400, { status: 'error', message: 'password required' });
    if (password !== null && body.current !== password) return json(res, 401, { status: 'error', message: 'current password required' });
    password = body.password;
    sessions.clear();
    if (protection === 'unset' || protection === 'off') protection = 'risky';
    return authed(res);
  }
  if (path === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (password === null || body.password !== password) return json(res, 401, { status: 'error', message: 'invalid password' });
    return authed(res);
  }
  if (path === '/api/auth/csrf') {
    const s = sessionOf(req);
    return s ? json(res, 200, { csrf: s.csrf }) : json(res, 401, { status: 'error' });
  }
  if (path.startsWith('/api/v1/')) {
    if (configDown) return json(res, 500, { status: 'error', message: 'Failed to retrieve system information' });
    if (path === '/api/v1/systeminfo') return json(res, 200, systeminfo);
    if (path === '/api/v1/network') return json(res, 200, network);
    return json(res, 404, { status: 'error', message: 'not found' });
  }
  if (path === '/__test/auth' && req.method === 'POST') {
    const body = await readBody(req);
    protection = body.protection ?? 'unset';
    password = body.password ?? null;
    sessions.clear();
    return json(res, 200, { protection });
  }
  if (path === '/__test/config' && req.method === 'POST') {
    configDown = (await readBody(req)).down === true;
    return json(res, 200, { configDown });
  }
  json(res, 404, { status: 'error', message: 'not found' });
}).listen(PORT, '127.0.0.1');
