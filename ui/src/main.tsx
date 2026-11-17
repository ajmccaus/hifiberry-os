// Entry point: kiosk hardening, start the live connections, mount the app.
// Constraint: nothing here waits for the network before the first render.

import { render } from 'preact';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/controls.css';
import './styles/now-playing.css';
import './styles/overlays.css';
import { startAcr } from './state/acr-store.ts';
import { startAuth } from './state/auth-sheet.ts';
import { loadScreen, loadSystem, startPowerWatch } from './state/device-store.ts';
import { isKiosk, startNav } from './state/nav.ts';
import { App } from './ui/App.tsx';

if (isKiosk) {
  // Touchscreen appliance: no zoom, no context menu, no text selection (CSS .kiosk).
  document.documentElement.classList.add('kiosk');
  document
    .querySelector('meta[name=viewport]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('gesturestart', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
}

startAuth();
startNav();
startAcr();
startPowerWatch();
void loadScreen();
void loadSystem();

const root = document.getElementById('app');
if (root) render(<App />, root);
