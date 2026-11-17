// Application shell: tab bar, current screen, player bar, compact menu, Now Playing and overlays.
// Constraint: renders immediately (no network wait); live data fills in as backends answer.

import { useEffect } from 'preact/hooks';
import { Home } from '../screens/Home.tsx';
import { Radio } from '../screens/Radio.tsx';
import { ScreenSettings } from '../screens/ScreenSettings.tsx';
import { Sources } from '../screens/Sources.tsx';
import { System } from '../screens/System.tsx';
import { menuOpen, screen } from '../state/nav.ts';
import { MainMenu, systemName, TopBar } from './Nav.tsx';
import { NowPlaying } from './NowPlaying.tsx';
import { Connecting, PasswordSheet, PowerOverlay } from './Overlays.tsx';
import { PlayerBar } from './PlayerBar.tsx';

const SCREENS = { home: Home, sources: Sources, radio: Radio, screen: ScreenSettings, system: System };

export function App() {
  const Current = SCREENS[screen.value];
  const name = systemName.value;
  useEffect(() => {
    document.title = name;
  }, [name]);
  return (
    <>
      <TopBar />
      <main class={`screens${menuOpen.value ? ' shifted' : ''}`}>
        <Current key={screen.value} />
      </main>
      <PlayerBar />
      <MainMenu />
      <NowPlaying />
      <PasswordSheet />
      <PowerOverlay />
      <Connecting />
    </>
  );
}
