// Unit tests for the volume send throttle, brightness debounce, slider model and position interpolation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debounce, throttle, type Timers } from '../../src/lib/timing.ts';
import { positionAt } from '../../src/state/position.ts';
import * as vol from '../../src/state/volume.ts';

/** Deterministic timers: advance() runs due callbacks in order. */
function fakeTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let id = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      id += 1;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void due.delete(h),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

test('volume throttle: first value at once, then at most one per 100 ms with the latest value', () => {
  const t = fakeTimers();
  const sent: number[] = [];
  const g = throttle<number>((v) => sent.push(v), 100, t);
  g.push(10);
  g.push(11);
  g.push(12);
  assert.deepEqual(sent, [10]);
  t.advance(99);
  assert.deepEqual(sent, [10]);
  t.advance(1);
  assert.deepEqual(sent, [10, 12], 'trailing send carries the newest value');
  for (let i = 0; i < 20; i++) {
    g.push(20 + i);
    t.advance(10);
  }
  assert.ok(sent.length <= 2 + 3, `~10/s while dragging (got ${sent.length - 2} in 200 ms)`);
});

test('volume throttle: flush sends the final value immediately and drops the pending one', () => {
  const t = fakeTimers();
  const sent: number[] = [];
  const g = throttle<number>((v) => sent.push(v), 100, t);
  g.push(1);
  g.push(2);
  g.flush(3);
  t.advance(1000);
  assert.deepEqual(sent, [1, 3]);
  g.flush(3);
  assert.deepEqual(sent, [1, 3, 3], 'final value is always sent, even if unchanged');
});

test('brightness debounce: sends after 300 ms quiet; release sends at once', () => {
  const t = fakeTimers();
  const sent: number[] = [];
  const g = debounce<number>((v) => sent.push(v), 300, t);
  g.push(10);
  t.advance(200);
  g.push(20);
  t.advance(299);
  assert.deepEqual(sent, []);
  t.advance(1);
  assert.deepEqual(sent, [20]);
  g.push(30);
  g.flush(40);
  t.advance(1000);
  assert.deepEqual(sent, [20, 40]);
});

test('volume model: the user value wins while dragging; server values apply after settling', () => {
  let s = vol.fromServer(vol.initialVolume, true, 50);
  assert.equal(vol.shown(s, 0), 50);
  s = vol.dragTo(s, 70);
  s = vol.fromServer(s, true, 55);
  assert.equal(vol.shown(s, 0), 70, 'server echo during drag is ignored for display');
  s = vol.release(s, 72, 1000);
  s = vol.fromServer(s, true, 60);
  assert.equal(vol.shown(s, 1100), 72, 'late echo of an intermediate value does not jump the handle');
  s = vol.fromServer(s, true, 72);
  assert.equal(s.settle, null, 'confirmation ends settling');
  assert.equal(vol.shown(s, 1200), 72);
  s = vol.release(s, 30, 2000);
  assert.equal(vol.shown(s, 2000 + vol.SETTLE_MS), 72, 'unconfirmed value gives way to the server value');
  s = vol.fromServer(s, true, 45);
  assert.equal(vol.shown(s, 99_999), 45, 'an external change moves the slider');
});

test('volume model: unavailable or failed disables without showing 0', () => {
  let s = vol.fromServer(vol.initialVolume, true, 40);
  s = vol.fromServer(s, false, null);
  assert.equal(vol.disabled(s), true);
  assert.equal(vol.shown(s, 0), 40);
  s = vol.fromServer(s, true, 40);
  assert.equal(vol.disabled(s), false);
  s = vol.failed(s);
  assert.equal(vol.disabled(s), true);
  assert.equal(vol.shown(s, 0), 40);
  assert.equal(vol.shown(vol.fromServer(vol.initialVolume, false, null), 0), null, 'never known: no handle at all');
});

test('position interpolation: advances while playing, frozen otherwise, clamped to duration', () => {
  const a = { value: 10, at: 1000 };
  assert.equal(positionAt(a, true, 60, 3500), 12.5);
  assert.equal(positionAt(a, false, 60, 3500), 10);
  assert.equal(positionAt(a, true, 11, 9000), 11);
  assert.equal(positionAt(a, true, undefined, 101_000), 110, 'streams have no duration');
  assert.equal(positionAt(a, true, 60, 500), 10, 'clock skew never runs backwards');
});
