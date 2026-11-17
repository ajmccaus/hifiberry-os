// Home: device name and the menu of screens (the reference product page without product imagery).
// Constraint: no vendor logos or product photos.

import { screenSettings, systemInfo } from '../state/device-store.ts';
import { show } from '../state/nav.ts';
import { systemName } from '../ui/Nav.tsx';
import { MenuItem } from '../ui/primitives.tsx';

export function Home() {
  const info = systemInfo.value.status === 'ready' ? systemInfo.value.value : null;
  const screenOk = screenSettings.value.status === 'ready' && screenSettings.value.value.available;
  return (
    <section class="screen home" data-screen="home" aria-label="Home">
      <div class="scroll">
        <div class="home-column">
          <h2 class="home-model">{info?.soundcard ?? info?.model ?? ''}</h2>
          <h1 class="home-name">{systemName.value}</h1>
          <div class="home-menu">
            <MenuItem icon="input" label="Sources" chevron onClick={() => show('sources')} />
            <MenuItem icon="radio" label="Radio" chevron onClick={() => show('radio')} />
            {screenOk && <MenuItem icon="screen" label="Screen" chevron onClick={() => show('screen')} />}
            <MenuItem icon="gear" label="System" chevron onClick={() => show('system')} />
          </div>
        </div>
      </div>
    </section>
  );
}
