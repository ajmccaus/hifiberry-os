// Pure volume-slider model: server value vs the user's drag, settling, and failure handling.
// Constraint: while dragging the user's value wins; an unavailable/failed control is disabled
// and keeps showing the last known level, never 0.

export interface VolumeState {
  /** Last level reported by ACR (REST or volume_changed), kept when the control goes away. */
  server: number | null;
  available: boolean;
  failed: boolean;
  drag: number | null;
  /** After release the user's final value is shown until ACR confirms it or the time runs out. */
  settle: { value: number; until: number } | null;
}

export const SETTLE_MS = 1500;

export const initialVolume: VolumeState = { server: null, available: false, failed: false, drag: null, settle: null };

export function fromServer(s: VolumeState, available: boolean, percentage: number | null): VolumeState {
  const server = percentage ?? s.server;
  const settled = s.settle && percentage !== null && Math.abs(percentage - s.settle.value) < 1 ? null : s.settle;
  return { ...s, server, available, failed: available ? false : s.failed, settle: settled };
}

export const dragTo = (s: VolumeState, value: number): VolumeState => ({ ...s, drag: value, settle: null });

export const release = (s: VolumeState, value: number, now: number): VolumeState => ({
  ...s,
  drag: null,
  settle: { value, until: now + SETTLE_MS },
});

export const failed = (s: VolumeState): VolumeState => ({ ...s, failed: true, drag: null, settle: null });

export function shown(s: VolumeState, now: number): number | null {
  if (s.drag !== null) return s.drag;
  if (s.settle && now < s.settle.until) return s.settle.value;
  return s.server;
}

export const disabled = (s: VolumeState): boolean => !s.available || s.failed || s.server === null;
