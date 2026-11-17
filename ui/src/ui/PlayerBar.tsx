// Permanently dark bottom bar: open-chevron, source icon, title/artist, mute, volume slider, volume icon.
// Constraint: always dark in both colour schemes; in compact layout the title strip pops up above it on track change.

import { useEffect, useState } from 'preact/hooks';
import { sourceInfo } from '../lib/sources.ts';
import { clock, player, song, toggleMute, volume, volumeCommit, volumeInput } from '../state/acr-store.ts';
import { menuOpen, nowPlayingOpen } from '../state/nav.ts';
import { disabled, shown } from '../state/volume.ts';
import { Icon, IconButton, Slider } from './primitives.tsx';

export function VolumeControl({ class: cls = '' }: { class?: string }) {
  const s = volume.value;
  const off = disabled(s);
  return (
    <div class={`slider-wrap volume ${cls}`}>
      <IconButton icon="volume-mute" label="Mute" class="mute" disabled={off} onClick={toggleMute} />
      <Slider value={shown(s, clock.value)} label="Volume" disabled={off} onInput={volumeInput} onCommit={volumeCommit} />
      <Icon name="volume" class="vol-icon" />
    </div>
  );
}

/** True for a few seconds after the shown title changes (compact layout's pop-up strip). */
function useTitleNotice(key: string): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!key) return setVisible(false);
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(t);
  }, [key]);
  return visible;
}

export function PlayerBar() {
  const p = player.value;
  const s = song.value;
  const info = p ? sourceInfo(p.name) : null;
  const title = s?.title ?? '';
  const notice = useTitleNotice(title ? `${title}\u0000${s?.artist ?? ''}` : '');
  const open = () => (nowPlayingOpen.value = true);
  return (
    <footer class={`player-bar${nowPlayingOpen.value ? ' shifted' : ''}`}>
      <div class="bar-wrap">
        <IconButton icon="chevron-thin-up" label="Show Now Playing" class="bar-chevron" onClick={open} />
        <button type="button" class={`mini-info${notice ? ' notice' : ''}`} onClick={open} aria-label="Show Now Playing">
          {info && <Icon name={info.icon} class="mini-source-icon" />}
          {title ? (
            <span class="mini-titles">
              <span class="mini-title">{title}</span>
              {s?.artist && <span class="mini-artist">{s.artist}</span>}
            </span>
          ) : (
            info && <span class="mini-source-name">{info.label}</span>
          )}
        </button>
        <VolumeControl class="white" />
        <IconButton icon="menu" label="Menu" class="menu-button" onClick={() => (menuOpen.value = !menuOpen.value)} />
      </div>
    </footer>
  );
}
