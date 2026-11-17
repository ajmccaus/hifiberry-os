// Modal layers: the reference-style "ask" dialog, the password sheet, Connecting and power overlays.
// Constraint: overlays never hide a failure silently; Connecting reflects only the audio service link.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { connection } from '../state/acr-store.ts';
import { authPrompt, cancelAuth, submitPassword } from '../state/auth-sheet.ts';
import { powerState } from '../state/device-store.ts';

export function Ask(props: { open: boolean; title: string; onCancel: () => void; children: ComponentChildren; label?: string }) {
  return (
    <>
      <div class={`plexi ask-plexi${props.open ? ' visible' : ''}`} onClick={props.onCancel} />
      <div class={`ask${props.open ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label={props.label ?? props.title} inert={!props.open}>
        <div class="ask-content">
          <h2>{props.title}</h2>
          {props.children}
        </div>
      </div>
    </>
  );
}

export function PasswordSheet() {
  const prompt = authPrompt.value;
  const [password, setPassword] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setPassword('');
    if (prompt) window.setTimeout(() => input.current?.focus(), 50);
  }, [prompt?.hint, prompt !== null]);
  const setting = prompt?.hint === 'set-password';
  const submit = (e: Event) => {
    e.preventDefault();
    if (password) void submitPassword(password);
  };
  return (
    <Ask open={prompt !== null} title={setting ? 'Set a password' : 'Password required'} onCancel={cancelAuth}>
      <form onSubmit={submit} class="password-form">
        <p>
          {setting
            ? 'Restart and shut down need a password when used from another device. Choose one now; it is asked for again on new devices.'
            : 'Enter the device password to continue.'}
        </p>
        <input
          ref={input}
          type="password"
          name="password"
          aria-label="Password"
          placeholder="Password"
          autocomplete={setting ? 'new-password' : 'current-password'}
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
        {prompt?.error && (
          <p class="error" role="alert">
            {prompt.error}
          </p>
        )}
        <div class="ask-buttons">
          <button type="submit" class="pill black" disabled={!password || prompt?.busy}>
            {setting ? 'Set password' : 'Continue'}
          </button>
          <button type="button" class="pill" onClick={cancelAuth}>
            Cancel
          </button>
        </div>
      </form>
    </Ask>
  );
}

export function Connecting() {
  if (connection.value === 'online' || powerState.value) return null;
  return (
    <div class="hud connecting" role="status" aria-live="polite">
      <div class="hud-content">
        <div class="hud-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>Connecting…</h1>
        <p>The audio system is starting. This can take a minute.</p>
      </div>
    </div>
  );
}

export function PowerOverlay() {
  const p = powerState.value;
  if (!p) return null;
  const restart = p.action === 'restart';
  return (
    <div class="hud power" role="status" aria-live="polite">
      <div class="hud-content">
        <h1>{restart ? 'Restarting…' : 'Shutting down…'}</h1>
        <p>
          {restart
            ? 'This takes about a minute. This page reconnects by itself.'
            : p.wentDown
              ? 'You can unplug the device now.'
              : 'You can unplug the device in a moment.'}
        </p>
      </div>
    </div>
  );
}
