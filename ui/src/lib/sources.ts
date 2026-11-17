// Friendly name, icon and "how to start it" hint per ACR player name.
// Constraint: keyed by ACR's stable player *name* (never the id); unknown players show their name.

export interface SourceInfo {
  label: string;
  icon: string;
  hint: string;
}

const KNOWN: Record<string, SourceInfo> = {
  librespot: { label: 'Spotify Connect', icon: 'spotify', hint: 'Choose this speaker in the Spotify app.' },
  shairport: { label: 'AirPlay', icon: 'airplay', hint: 'Choose this speaker as the AirPlay output on your Apple device.' },
  bluetooth: { label: 'Bluetooth', icon: 'bluetooth', hint: "Connect to this speaker in your phone's Bluetooth settings." },
  mpd: { label: 'Radio & music', icon: 'mpd', hint: 'Pick a station on the Radio screen.' },
  raat: { label: 'Roon', icon: 'roon', hint: 'Choose this speaker in Roon.' },
};

export const sourceInfo = (name: string): SourceInfo =>
  KNOWN[name] ?? { label: name, icon: 'input', hint: 'Start playback from the source app.' };

/** Name of the radio player stations are played on (upstream's default radioPlayer). */
export const RADIO_PLAYER = 'mpd';
