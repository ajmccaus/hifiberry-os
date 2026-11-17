// Navigation: current screen (mirrored in location.hash), Now Playing, the compact menu, kiosk idle return.
// Constraint: kiosk mode is decided only by the page's own host (loaded from localhost/127.0.0.1).

import { signal } from '@preact/signals';
import { playing } from './acr-store.ts';

export type ScreenId = 'home' | 'sources' | 'radio' | 'screen' | 'system';
const SCREENS: readonly ScreenId[] = ['home', 'sources', 'radio', 'screen', 'system'];

export const isKiosk = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const fromHash = (): ScreenId => SCREENS.find((s) => `#/${s}` === location.hash) ?? 'home';

export const screen = signal<ScreenId>(fromHash());
export const nowPlayingOpen = signal(isKiosk);
export const menuOpen = signal(false);

export function show(id: ScreenId): void {
  screen.value = id;
  menuOpen.value = false;
  nowPlayingOpen.value = false;
  const hash = id === 'home' ? '' : `#/${id}`;
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
}

const IDLE_RETURN_MS = 60_000;
let lastInteraction = Date.now();

export function startNav(): void {
  window.addEventListener('hashchange', () => show(fromHash()));
  if (!isKiosk) return;
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(type, () => (lastInteraction = Date.now()), { capture: true, passive: true });
  }
  window.setInterval(() => {
    if (!nowPlayingOpen.value && playing.value && Date.now() - lastInteraction >= IDLE_RETURN_MS) {
      menuOpen.value = false;
      nowPlayingOpen.value = true;
    }
  }, 1000);
}
