// Navigation chrome: the top tab bar (wide layout) and the dark slide-in menu (compact layout).
// Constraint: both render the same tab list; which one is visible is decided by CSS breakpoints only.

import { computed } from '@preact/signals';
import { screenSettings, systemInfo } from '../state/device-store.ts';
import { menuOpen, screen, show, type ScreenId } from '../state/nav.ts';
import { Icon } from './primitives.tsx';

interface Tab {
  id: ScreenId;
  label: string;
  icon: string;
}

export const systemName = computed(() =>
  systemInfo.value.status === 'ready' && systemInfo.value.value.name ? systemInfo.value.value.name : 'Home',
);

const tabs = computed((): Tab[] => {
  const s = screenSettings.value;
  const list: Tab[] = [
    { id: 'sources', label: 'Sources', icon: 'input' },
    { id: 'radio', label: 'Radio', icon: 'radio' },
  ];
  if (s.status === 'ready' && s.value.available) list.push({ id: 'screen', label: 'Screen', icon: 'screen' });
  list.push({ id: 'system', label: 'System', icon: 'gear' });
  return list;
});

export function TopBar() {
  const current = screen.value;
  const item = (id: ScreenId, label: string, cls = '') => (
    <button
      type="button"
      class={`tab ${cls}${current === id ? ' selected' : ''}`}
      aria-current={current === id ? 'page' : undefined}
      onClick={() => show(id)}
    >
      {label}
    </button>
  );
  return (
    <nav class="top-bar" aria-label="Main">
      <div class="tabs">
        <div class="tab-spacer" />
        {item('home', systemName.value, 'name')}
        <div class="tab-separator" />
        {tabs.value.map((t) => item(t.id, t.label))}
        <div class="tab-separator" />
      </div>
    </nav>
  );
}

export function MainMenu() {
  const current = screen.value;
  const row = (id: ScreenId, label: string, icon: string) => (
    <button type="button" class={`menu-row${current === id ? ' selected' : ''}`} onClick={() => show(id)}>
      <Icon name={icon} class="item-icon" />
      <span class="item-label">{label}</span>
    </button>
  );
  return (
    <>
      <div class={`plexi menu-plexi${menuOpen.value ? ' visible' : ''}`} onClick={() => (menuOpen.value = false)} />
      <nav class={`main-menu${menuOpen.value ? ' open' : ''}`} aria-label="Main" aria-hidden={!menuOpen.value} inert={!menuOpen.value}>
        {row('home', systemName.value, 'sound-signature')}
        <hr />
        {tabs.value.map((t) => row(t.id, t.label, t.icon))}
        <hr />
      </nav>
    </>
  );
}
