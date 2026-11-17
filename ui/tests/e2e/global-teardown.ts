// Stops the e2e stack after the suite unless KEEP_STACK=1 (handy while iterating).
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UI = fileURLToPath(new URL('../..', import.meta.url));

export default function globalTeardown(): void {
  if (process.env['KEEP_STACK'] === '1') return;
  execSync('bash tests/stack.sh stop', { cwd: UI, stdio: 'inherit' });
}
