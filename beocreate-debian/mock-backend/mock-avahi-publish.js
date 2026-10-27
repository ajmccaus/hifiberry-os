#!/usr/bin/env node
/* Mock avahi-publish for Beocreate-on-Debian tests.

The server runs `$BEO_AVAHI_PUBLISH -s <name> <type> <port> <txt>...` (no shell)
and keeps it running while the service is announced; the tests point
BEO_AVAHI_PUBLISH at this script. Each start appends {"argv": [...]} and each
exit {"exit": <signal>} as one JSON line to MOCK_AVAHI_LOG (if set). It runs
until SIGTERM, or until its parent (the server) is gone.
*/

const fs = require("fs");

function log(entry) {
	if (process.env.MOCK_AVAHI_LOG) fs.appendFileSync(process.env.MOCK_AVAHI_LOG, JSON.stringify(entry) + "\n");
}

log({argv: process.argv.slice(2)});
process.on("SIGTERM", () => { log({exit: "SIGTERM"}); process.exit(0); });
const parent = process.ppid;
setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 500);
