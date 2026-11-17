// Full-screen Now Playing: artwork, title/artist/album, dark transport strip with volume.
// Constraint: buttons follow the active player's *current* capabilities; artwork is preloaded and
// cross-faded, with a neutral placeholder when absent or failing.

import { useEffect, useRef, useState } from 'preact/hooks';
import { sourceInfo } from '../lib/sources.ts';
import { command, controls, player, position, song } from '../state/acr-store.ts';
import { nowPlayingOpen } from '../state/nav.ts';
import { portrait } from './media.ts';
import { Icon, IconButton } from './primitives.tsx';
import { VolumeControl } from './PlayerBar.tsx';

interface Layer {
  url: string;
  key: number;
  /** Fading out to the placeholder (no artwork, or it failed to load). */
  out: boolean;
}

/** Shows `url` once it has loaded, fading it in over the previous image (or the placeholder). */
function Artwork({ url, placeholder }: { url: string | null; placeholder: string }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    let canceled = false;
    const retire = () => setLayers((ls) => ls.map((l) => ({ ...l, out: true })));
    if (!url) {
      retire();
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (canceled) return;
      seq.current += 1;
      const key = seq.current;
      setLayers((ls) => [...ls, { url, key, out: false }]);
    };
    img.onerror = () => !canceled && retire();
    img.src = url;
    return () => {
      canceled = true;
    };
  }, [url]);
  // A finished fade-in drops the images below it; a finished fade-out removes itself.
  const animationEnd = (l: Layer) =>
    setLayers((ls) => (l.out ? ls.filter((x) => x.key !== l.key) : ls.filter((x) => x.key >= l.key)));
  return (
    <div class="artwork" data-testid="artwork">
      <div class="art-placeholder">
        <Icon name={placeholder} class="art-placeholder-icon" />
      </div>
      {layers.map((l) => (
        <img
          key={l.key}
          class={`art-img${l.out ? ' out' : ''}`}
          src={l.url}
          alt=""
          draggable={false}
          onAnimationEnd={() => animationEnd(l)}
        />
      ))}
    </div>
  );
}

function Transport() {
  const t = controls.value;
  const btn = (show: boolean, icon: string, label: string, cmd: string | null) => (
    <button
      type="button"
      class={`t-btn${show ? '' : ' off'}`}
      aria-label={label}
      aria-hidden={!show}
      disabled={!show}
      onClick={() => cmd && command(cmd)}
    >
      <Icon name={icon} />
    </button>
  );
  return (
    <div class="transport">
      {btn(t.previous, 'previous-track', 'Previous', 'previous')}
      {btn(t.toggle !== null, t.toggle === 'pause' ? 'pause' : 'play', t.toggle === 'pause' ? 'Pause' : 'Play', t.toggleCommand)}
      {btn(t.next, 'next-track', 'Next', 'next')}
    </div>
  );
}

function Progress() {
  const duration = song.value?.duration;
  const pos = position.value;
  if (!duration || pos === null) return null;
  return (
    <div class="np-progress" role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(pos)}>
      <div style={{ width: `${(pos / duration) * 100}%` }} />
    </div>
  );
}

export function NowPlaying() {
  const open = nowPlayingOpen.value;
  const p = player.value;
  const s = song.value;
  const info = p ? sourceInfo(p.name) : null;
  const art = <Artwork url={s?.coverArtUrl ?? null} placeholder={info?.icon ?? 'sound-signature'} />;
  return (
    <section class={`now-playing${open ? ' open' : ''}`} aria-label="Now Playing" aria-hidden={!open} inert={!open}>
      {!portrait.value && <div class="np-left">{art}</div>}
      <div class="np-right">
        <header class="np-header">
          <IconButton icon="chevron-thin-down" label="Close Now Playing" class="np-close" onClick={() => (nowPlayingOpen.value = false)} />
          {info && (
            <div class="np-source">
              <Icon name={info.icon} />
              <span>{info.label}</span>
            </div>
          )}
        </header>
        <div class="np-upper">
          {portrait.value && art}
          <div class="np-info">
            {s?.title && <h1 class="np-title">{s.title}</h1>}
            {s?.title && (s.artist || s.album) && (
              <h2 class="np-artist">
                {s.artist && <span class="artist">{s.artist}</span>}
                {s.artist && s.album && ' — '}
                {s.album}
              </h2>
            )}
            <Progress />
          </div>
        </div>
        <div class="np-lower">
          <div class="control-area">
            <Transport />
            <VolumeControl class="white" />
          </div>
        </div>
      </div>
    </section>
  );
}
