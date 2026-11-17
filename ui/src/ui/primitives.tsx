// Small presentational building blocks: mask-coloured icon, slider, segmented control, menu row.
// Constraint: no app state here; everything arrives through props (the slider is pointer-event driven).

import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { iconUrl } from './icons.ts';

export const Icon = ({ name, class: cls = '' }: { name: string; class?: string }) => (
  <span class={`sym ${cls}`} style={{ '--icon': `url(${iconUrl(name)})` }} aria-hidden="true" />
);

export const IconButton = (props: { icon: string; label: string; onClick: () => void; class?: string; disabled?: boolean }) => (
  <button
    type="button"
    class={`sym-btn ${props.class ?? ''}`}
    aria-label={props.label}
    title={props.label}
    disabled={props.disabled}
    onClick={props.onClick}
  >
    <Icon name={props.icon} />
  </button>
);

export interface SliderProps {
  value: number | null;
  label: string;
  disabled?: boolean;
  onInput: (value: number) => void;
  onCommit: (value: number) => void;
}

/** 0-100 slider. Drag anywhere on the (44 px tall) track; the value on release is committed. */
export function Slider({ value, label, disabled, onInput, onCommit }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const at = (clientX: number): number => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  };
  const end = (e: PointerEvent): void => {
    if (drag.current === null) return;
    const v = e.type === 'pointercancel' ? drag.current : at(e.clientX);
    drag.current = null;
    onCommit(v);
  };
  const step = (e: KeyboardEvent): void => {
    const delta = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[e.key];
    if (delta === undefined || disabled || value === null) return;
    e.preventDefault();
    onCommit(Math.min(100, Math.max(0, value + delta)));
  };
  const v = value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <div
      ref={ref}
      class={`slider${disabled ? ' disabled' : ''}${drag.current !== null ? ' active' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v === null ? undefined : Math.round(v)}
      aria-disabled={disabled ? 'true' : undefined}
      onPointerDown={(e) => {
        if (disabled || e.button > 0) return;
        ref.current?.setPointerCapture(e.pointerId);
        drag.current = at(e.clientX);
        onInput(drag.current);
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        drag.current = at(e.clientX);
        onInput(drag.current);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={step}
    >
      <div class="track" />
      {v !== null && <div class="fill" style={{ width: `${v}%` }} />}
      {v !== null && <div class="handle" style={{ left: `${v}%` }} />}
    </div>
  );
}

export function Segmented<T extends string | number>(props: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          class={o.value === props.value ? 'selected' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface MenuItemProps {
  icon?: string;
  label: string;
  value?: string;
  /** Icon at the right end (e.g. the "playing" marker). */
  marker?: string;
  chevron?: boolean;
  onClick?: () => void;
  href?: string;
  children?: ComponentChildren;
  class?: string;
}

/** A 46 px settings row; a button when it does something, a link with href, else static. */
export function MenuItem(p: MenuItemProps) {
  const body = (
    <>
      {p.icon && <Icon name={p.icon} class="item-icon" />}
      <span class="item-label">{p.label}</span>
      {p.value !== undefined && <span class="item-value">{p.value}</span>}
      {p.children}
      {p.marker && <Icon name={p.marker} class="item-icon right" />}
    </>
  );
  const cls = `item${p.chevron ? ' chevron' : ''}${p.icon ? ' with-icon' : ''} ${p.class ?? ''}`;
  if (p.href) {
    return (
      <a class={cls} href={p.href}>
        {body}
      </a>
    );
  }
  if (p.onClick) {
    return (
      <button type="button" class={cls} onClick={p.onClick}>
        {body}
      </button>
    );
  }
  return <div class={`${cls} static`}>{body}</div>;
}
