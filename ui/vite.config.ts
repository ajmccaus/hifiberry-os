// Vite build of the audio-os UI: dist/index.html + hashed assets under dist/ui/ (nginx serves /ui/).
// Constraint: the built page references only /ui/... URLs and makes no external request at load.
// `DEVICE=http://<speaker> npm run dev` proxies /api (incl. WebSockets) to a real device.

import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: {
    outDir: 'dist',
    assetsDir: 'ui',
    assetsInlineLimit: 0,
    target: ['es2022', 'safari15'],
    modulePreload: { polyfill: false },
  },
  server: {
    proxy: { '/api': { target: process.env['DEVICE'] ?? 'http://audio-os.local', changeOrigin: true, ws: true } },
  },
});
