// Settings-screen frame: sidebar title + back row (wide) or header + large title (compact).
// Constraint: the same markup serves both layouts; CSS breakpoints switch between them.

import type { ComponentChildren } from 'preact';
import { show } from '../state/nav.ts';
import { Icon } from '../ui/primitives.tsx';

export function Frame({ id, title, children }: { id: string; title: string; children: ComponentChildren }) {
  return (
    <section class="screen framed" data-screen={id} aria-label={title}>
      <header class="screen-header">
        <button type="button" class="back" onClick={() => show('home')}>
          <Icon name="back" />
          <span>Home</span>
        </button>
        <h1>{title}</h1>
      </header>
      <div class="scroll">
        <h1 class="large-title">{title}</h1>
        <div class="content">{children}</div>
      </div>
    </section>
  );
}
