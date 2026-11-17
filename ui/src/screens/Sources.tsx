// Sources: ACR's players with friendly names; the playing one is marked; tap plays/pauses when possible.
// Constraint: ACR cannot "select" a player; a row only sends what that player's capabilities allow,
// otherwise it explains where playback is started.

import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { sourceInfo } from '../lib/sources.ts';
import { model, playerCommand } from '../state/acr-store.ts';
import { transport } from '../state/acr-model.ts';
import { MenuItem } from '../ui/primitives.tsx';
import { Frame } from './Frame.tsx';

export function Sources() {
  const [hint, setHint] = useState<string | null>(null);
  const players = model.value.players;
  return (
    <Frame id="sources" title="Sources">
      {players.length === 0 && <p>No sources are available yet.</p>}
      {players.map((p) => {
        const info = sourceInfo(p.name);
        const cmd = transport(p).toggleCommand;
        const tap = () => {
          if (cmd) {
            setHint(null);
            playerCommand(p.name, cmd).catch(() => setHint(p.name));
          } else setHint(hint === p.name ? null : p.name);
        };
        return (
          <Fragment key={p.name}>
            <MenuItem
              icon={info.icon}
              label={info.label}
              value={p.state === 'paused' ? 'Paused' : undefined}
              marker={p.state === 'playing' ? 'volume' : undefined}
              onClick={tap}
              class={`source${p.state === 'playing' ? ' playing' : ''}`}
            />
            {hint === p.name && (
              <p class="hint" role="status">
                {info.hint}
              </p>
            )}
          </Fragment>
        );
      })}
    </Frame>
  );
}
