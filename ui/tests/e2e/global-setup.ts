// Builds the UI and brings the e2e stack up (idempotent) before the suite.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UI = fileURLToPath(new URL('../..', import.meta.url));

export default function globalSetup(): void {
  execSync('npm run build', { cwd: UI, stdio: 'inherit' });
  execSync('bash tests/stack.sh start', { cwd: UI, stdio: 'inherit' });
}
