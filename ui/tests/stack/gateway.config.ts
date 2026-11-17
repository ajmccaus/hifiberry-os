// Test gateway: `vite preview` of dist/ reproducing the nginx front door (FACTS "Web front door"):
// /api/audiocontrol -> ACR (WebSocket, X-Forwarded-Prefix), /api/device -> helper, /api/config ->
// configurator stub, /api/auth -> auth stub, auth_request on every /api route, CSP on the document.
// Constraint: GATEWAY_ROLE=kiosk (127.0.0.1) skips auth for /api/device like nginx's
// `satisfy any; allow 127.0.0.1`; GATEWAY_ROLE=lan (127.0.0.2) is a LAN client and never does.

import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const role = process.env['GATEWAY_ROLE'] === 'lan' ? 'lan' : 'kiosk';
const ACR = 'http://127.0.0.1:1080';
const HELPER = 'http://127.0.0.1:1190';
const STUBS = 'http://127.0.0.1:1191';

const CSP =
  "default-src 'self'; img-src 'self' data: https: http:; " +
  "connect-src 'self' https://*.api.radio-browser.info https://all.api.radio-browser.info; " +
  "style-src 'self' 'unsafe-inline'; frame-ancestors 'self'";

const nginx: Plugin = {
  name: 'nginx-front-door',
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? '/';
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (!url.startsWith('/api/') && !url.startsWith('/ui/')) {
        res.setHeader('Content-Security-Policy', CSP);
        res.setHeader('Cache-Control', 'no-cache');
      }
      if (!url.startsWith('/api/') || url.startsWith('/api/auth/')) return next();
      if (role === 'kiosk' && url.startsWith('/api/device/')) return next();
      const headers: Record<string, string> = {
        'X-Original-Method': req.method ?? 'GET',
        'X-Original-URI': url,
        Cookie: req.headers.cookie ?? '',
      };
      const csrf = req.headers['x-csrf-token'];
      if (typeof csrf === 'string') headers['X-CSRF-Token'] = csrf;
      fetch(`${STUBS}/_auth/verify`, { headers })
        .then((r) => {
          if (r.status === 200) return next();
          res.statusCode = 401;
          res.setHeader('WWW-Authenticate-Hint', r.headers.get('WWW-Authenticate-Hint') ?? 'login');
          res.end('401 Authorization Required');
        })
        .catch(() => {
          res.statusCode = 500;
          res.end();
        });
    });
  },
};

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [nginx],
  build: { outDir: 'dist' },
  logLevel: 'warn',
  preview: {
    host: role === 'lan' ? '127.0.0.2' : '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api/audiocontrol': {
        target: ACR,
        ws: true,
        rewrite: (p) => p.replace(/^\/api\/audiocontrol/, '/api'),
        headers: { 'X-Forwarded-Prefix': '/api/audiocontrol' },
      },
      '/api/device': { target: HELPER },
      '/api/config': { target: STUBS, rewrite: (p) => p.replace(/^\/api\/config/, '/api') },
      '/api/auth': { target: STUBS },
    },
  },
});
