#!/usr/bin/env node
/* Mock systemctl for Beocreate-on-Debian tests (ADR 0002).

The screen extension runs `$BEO_SYSTEMCTL <args>` (no shell); the tests point
BEO_SYSTEMCTL at this script. Each call appends its arguments, space-joined,
as one line to the file named by MOCK_SYSTEMCTL_LOG (if set), then:
  show -p LoadState --value touch-timeout.service
      prints MOCK_TOUCH_TIMEOUT (default "not-found": direct mode;
      "loaded": daemon mode)
  anything else: prints nothing.
Always exits 0.
*/

const fs = require("fs");

const args = process.argv.slice(2);
if (process.env.MOCK_SYSTEMCTL_LOG) {
	fs.appendFileSync(process.env.MOCK_SYSTEMCTL_LOG, args.join(" ") + "\n");
}
if (args.join(" ") === "show -p LoadState --value touch-timeout.service") {
	process.stdout.write((process.env.MOCK_TOUCH_TIMEOUT || "not-found") + "\n");
}
