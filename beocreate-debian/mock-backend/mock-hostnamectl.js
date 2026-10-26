#!/usr/bin/env node
/* Mock hostnamectl for Beocreate-on-Debian tests.

The server runs `$BEO_HOSTNAMECTL <args>` (no shell); the tests point
BEO_HOSTNAMECTL at this script. Each call appends its argument vector as one
JSON line to the file named by MOCK_HOSTNAMECTL_LOG (if set), so a test sees
every argument exactly as received. `set-hostname ...` exits 0; queries
(`--pretty`, `--static`) exit 1, as on a system without systemd-hostnamed,
so the server never goes on to rewrite /etc/hosts.
*/

const fs = require("fs");

const args = process.argv.slice(2);
if (process.env.MOCK_HOSTNAMECTL_LOG) {
	fs.appendFileSync(process.env.MOCK_HOSTNAMECTL_LOG, JSON.stringify(args) + "\n");
}
process.exitCode = (args[0] === "set-hostname") ? 0 : 1;
