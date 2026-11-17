// Playback position interpolation: MPD pushes no position events, so the UI advances it locally.
// Constraint: pure; the result never runs past the song's duration or below zero.

export interface PositionAnchor {
  value: number;
  at: number;
}

export function positionAt(anchor: PositionAnchor, playing: boolean, duration: number | undefined, now: number): number {
  const elapsed = playing ? Math.max(0, now - anchor.at) / 1000 : 0;
  const value = Math.max(0, anchor.value + elapsed);
  return duration !== undefined ? Math.min(value, duration) : value;
}
