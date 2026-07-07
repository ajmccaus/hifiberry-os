#!/bin/sh
# Run the Playwright test suite for the Beocreate-on-Debian port.
# Installs dependencies for the server, the mock backend and the tests,
# then runs Playwright (which starts/stops the server and mocks itself).
# Exits non-zero on any failure.

set -e

BASE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing server dependencies"
(cd "$BASE/server" && npm install --no-audit --no-fund)

echo "==> Installing mock backend dependencies"
(cd "$BASE/mock-backend" && npm install --no-audit --no-fund)

echo "==> Installing test dependencies"
(cd "$BASE/tests" && npm install --no-audit --no-fund)

echo "==> Running Playwright tests"
cd "$BASE/tests"
exec npx playwright test "$@"
