// Screen: backlight brightness and the "turn screen off after" timeout (touch-timeout via the helper).
// Constraint: shown only when the helper reports a backlight; brightness sends are debounced (~300 ms)
// with the final value sent on release.

import { brightnessCommit, brightnessInput, screenSettings, setScreenTimeout } from '../state/device-store.ts';
import { Icon, Segmented, Slider } from '../ui/primitives.tsx';
import { Frame } from './Frame.tsx';

const TIMEOUTS = [
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 1800, label: '30 min' },
  { value: 7200, label: '2 h' },
] as const;

export function ScreenSettings() {
  const s = screenSettings.value;
  const ready = s.status === 'ready' && s.value.available ? s.value : null;
  return (
    <Frame id="screen" title="Screen">
      {!ready && <p>Screen settings are not available right now.</p>}
      {ready && (
        <>
          <h2>Brightness</h2>
          <div class="slider-wrap">
            <Icon name="brightness-low" />
            <Slider value={ready.brightness} label="Brightness" onInput={brightnessInput} onCommit={brightnessCommit} />
            <Icon name="brightness-high" />
          </div>
          <h2>Turn screen off after</h2>
          <Segmented
            label="Turn screen off after"
            options={TIMEOUTS}
            value={TIMEOUTS.some((t) => t.value === ready.timeout) ? ready.timeout : null}
            onChange={setScreenTimeout}
          />
        </>
      )}
    </Frame>
  );
}
