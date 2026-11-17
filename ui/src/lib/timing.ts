// Throttle and debounce with injectable timers (unit-tested with a fake clock).
// Constraint: flush() always delivers the given value immediately and drops anything pending.

export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h),
};

export interface Gate<T> {
  push(value: T): void;
  flush(value: T): void;
  cancel(): void;
}

/** At most one send per interval; the latest value pushed during the wait is sent when it ends. */
export function throttle<T>(send: (value: T) => void, intervalMs: number, timers: Timers = realTimers): Gate<T> {
  let lastSent = Number.NEGATIVE_INFINITY;
  let handle: number | null = null;
  let pending: { value: T } | null = null;
  const fire = (value: T): void => {
    lastSent = timers.now();
    send(value);
  };
  const cancel = (): void => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
    pending = null;
  };
  return {
    push(value) {
      const wait = lastSent + intervalMs - timers.now();
      if (wait <= 0 && handle === null) return fire(value);
      pending = { value };
      handle ??= timers.setTimeout(() => {
        handle = null;
        const p = pending;
        pending = null;
        if (p) fire(p.value);
      }, Math.max(0, wait));
    },
    flush(value) {
      cancel();
      fire(value);
    },
    cancel,
  };
}

/** Sends once the value has been quiet for delayMs. */
export function debounce<T>(send: (value: T) => void, delayMs: number, timers: Timers = realTimers): Gate<T> {
  let handle: number | null = null;
  const cancel = (): void => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };
  return {
    push(value) {
      cancel();
      handle = timers.setTimeout(() => {
        handle = null;
        send(value);
      }, delayMs);
    },
    flush(value) {
      cancel();
      send(value);
    },
    cancel,
  };
}
