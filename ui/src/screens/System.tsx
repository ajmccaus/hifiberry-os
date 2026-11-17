// System: name, model, sound card, address, software version; Advanced settings; Restart / Shut down.
// Constraint: power goes through the reference-style confirm dialog; the kiosk gets a text hint
// instead of the Advanced settings link (no keyboard, no way back from upstream's UI).

import { useEffect, useState } from 'preact/hooks';
import { deviceAddress, loadSystem, network, requestPower, systemInfo, version, type PowerAction } from '../state/device-store.ts';
import { isKiosk } from '../state/nav.ts';
import { Ask } from '../ui/Overlays.tsx';
import { MenuItem } from '../ui/primitives.tsx';
import { Frame } from './Frame.tsx';

const ADVANCED_PATH = '/services';

export function System() {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => void loadSystem(), []);
  const info = systemInfo.value.status === 'ready' ? systemInfo.value.value : null;
  const net = network.value.status === 'ready' ? network.value.value : null;
  const ver = version.value.status === 'ready' ? version.value.value : null;
  const address = deviceAddress();
  const configDown = systemInfo.value.status === 'error' || network.value.status === 'error';
  const dash = '—';
  const choose = async (action: PowerAction) => {
    setError(false);
    if (await requestPower(action)) setAsking(false);
    else setError(true);
  };
  return (
    <Frame id="system" title="System">
      <h2>About</h2>
      <MenuItem label="Name" value={info?.name ?? dash} />
      <MenuItem label="Model" value={info?.model ?? dash} />
      <MenuItem label="Sound card" value={info?.soundcard ?? dash} />
      <MenuItem label="Address" value={net?.interfaces.map((i) => i.ipv4).join(', ') || dash} />
      <MenuItem label="Software" value={ver ?? dash} />
      {configDown && <p>Some system details are not available right now.</p>}
      <hr />
      {isKiosk ? (
        <>
          <MenuItem icon="share" label="Advanced settings" />
          <p class="hint">
            Open {address ? <strong>http://{address}{ADVANCED_PATH}</strong> : 'this speaker'} on a phone or computer in the
            same network.
          </p>
        </>
      ) : (
        <MenuItem icon="share" label="Advanced settings" href={ADVANCED_PATH} chevron />
      )}
      <MenuItem
        icon="power"
        label="Power…"
        onClick={() => {
          setError(false);
          setAsking(true);
        }}
      />
      <Ask open={asking} title="Power" onCancel={() => setAsking(false)}>
        {error && (
          <p class="error" role="alert">
            The request was not accepted.
          </p>
        )}
        <div class="ask-buttons">
          <button type="button" class="pill" onClick={() => void choose('shutdown')}>
            Shut down
          </button>
          <button type="button" class="pill" onClick={() => void choose('restart')}>
            Restart
          </button>
          <button type="button" class="pill black cancel" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </div>
      </Ask>
    </Frame>
  );
}
