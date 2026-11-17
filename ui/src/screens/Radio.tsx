// Radio: favorite stations (shared by all browsers via the helper) and radio-browser.info search.
// Constraint: the kiosk has no keyboard, so search is offered only on phones/desktops; station
// names and logos are untrusted (rendered as text; logos only from http(s) URLs).

import { useEffect, useState } from 'preact/hooks';
import type { Station } from '../api/device.ts';
import { searchStations } from '../api/radio-browser.ts';
import { RADIO_PLAYER } from '../lib/sources.ts';
import { model, song } from '../state/acr-store.ts';
import {
  addStation,
  deviceAddress,
  loadStations,
  loadSystem,
  network,
  playStation,
  radioError,
  removeStation,
  stations,
} from '../state/device-store.ts';
import { isKiosk } from '../state/nav.ts';
import { Icon, IconButton } from '../ui/primitives.tsx';
import { Frame } from './Frame.tsx';

function StationLogo({ station }: { station: Station }) {
  const [failed, setFailed] = useState(false);
  return station.favicon && !failed ? (
    <img class="item-icon logo" src={station.favicon} alt="" draggable={false} onError={() => setFailed(true)} />
  ) : (
    <Icon name="radio" class="item-icon" />
  );
}

function Search({ favorites }: { favorites: Station[] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Station[] | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const run = (e: Event) => {
    e.preventDefault();
    if (!query.trim()) return;
    setState('busy');
    searchStations(query)
      .then((r) => {
        setResults(r);
        setState('idle');
      })
      .catch(() => setState('error'));
  };
  return (
    <>
      <h2>Find stations</h2>
      <form class="search" onSubmit={run} role="search">
        <Icon name="search" class="search-icon" />
        <input
          type="search"
          name="q"
          aria-label="Station name"
          placeholder="Station name"
          enterkeyhint="search"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </form>
      {state === 'busy' && <p>Searching…</p>}
      {state === 'error' && <p>The station directory could not be reached.</p>}
      {state === 'idle' && results?.length === 0 && <p>No stations found.</p>}
      {results?.map((s) => {
        const added = favorites.some((f) => f.url === s.url);
        return (
          <div class="item with-icon station result" key={s.id}>
            <StationLogo station={s} />
            <span class="item-label">{s.name}</span>
            {added ? (
              <span class="item-value">Added</span>
            ) : (
              <IconButton icon="add" label={`Add ${s.name}`} onClick={() => void addStation(s)} />
            )}
          </div>
        );
      })}
    </>
  );
}

export function Radio() {
  useEffect(() => {
    void loadStations();
    if (isKiosk && network.value.status !== 'ready') void loadSystem();
    const t = window.setInterval(() => void loadStations(), 15000);
    return () => window.clearInterval(t);
  }, []);
  const list = stations.value;
  const favorites = list.status === 'ready' ? list.value : [];
  const playingUrl = model.value.active === RADIO_PLAYER ? song.value?.streamUrl : undefined;
  const address = deviceAddress();
  return (
    <Frame id="radio" title="Radio">
      <h2>Favorites</h2>
      {list.status === 'error' && <p>Favorites are not available right now.</p>}
      {list.status === 'ready' && favorites.length === 0 && <p>No favorite stations yet.</p>}
      {favorites.map((s) => (
        <div class="item with-icon station favorite" key={s.id}>
          <button type="button" class="station-play" onClick={() => void playStation(s)} aria-label={`Play ${s.name}`}>
            <StationLogo station={s} />
            <span class="item-label">{s.name}</span>
            {playingUrl === s.url && <Icon name="volume" class="item-icon right" />}
          </button>
          <IconButton icon="close" label={`Remove ${s.name}`} onClick={() => void removeStation(s.id)} />
        </div>
      ))}
      {radioError.value && (
        <p class="error" role="alert">
          {radioError.value}
        </p>
      )}
      {isKiosk ? (
        <p class="hint">
          To add stations, open {address ? <strong>http://{address}/#/radio</strong> : 'this speaker'} on a phone or computer in
          the same network.
        </p>
      ) : (
        <Search favorites={favorites} />
      )}
    </Frame>
  );
}
