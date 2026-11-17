// Layout media queries the components need in JS (CSS owns everything else).
// Constraint: the portrait query is the legacy Now Playing breakpoint (max-aspect-ratio 16/12).

import { signal, type Signal } from '@preact/signals';

function query(q: string): Signal<boolean> {
  const mq = window.matchMedia(q);
  const s = signal(mq.matches);
  mq.addEventListener('change', () => (s.value = mq.matches));
  return s;
}

export const portrait = query('(max-aspect-ratio: 16/12)');
