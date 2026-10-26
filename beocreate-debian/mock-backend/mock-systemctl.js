#!/usr/bin/env node
/* Mock systemctl for Beocreate-on-Debian tests (ADR 0002).

The server runs `$BEO_SYSTEMCTL <args>` (no shell); the tests point
BEO_SYSTEMCTL at this script. Each call appends its arguments, space-joined,
as one line to the file named by MOCK_SYSTEMCTL_LOG (if set), then:
  is-active touch-timeout.service
      prints MOCK_TOUCH_TIMEOUT, the unit's ActiveState (default "inactive":
      direct mode; "active": daemon mode), and exits 0 only for "active",
      as systemctl does
  show -p ExecStart --value touch-timeout.service
      prints MOCK_TOUCH_TIMEOUT_EXECSTART, default the command line of
      Beocreate's drop-in as systemd stores it ($BEO_SCREEN_ARGS unexpanded)
  anything else: prints nothing and exits 0.
MOCK_SYSTEMCTL_EXIT, if set, is the exit code of every call instead
(systemctl failing, e.g. no systemd).
*/

const fs = require("fs");

const DROP_IN_EXECSTART = "{ path=/usr/bin/touch-timeout ; argv[]=/usr/bin/touch-timeout $TOUCH_TIMEOUT_ARGS $BEO_SCREEN_ARGS ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }";

const args = process.argv.slice(2);
if (process.env.MOCK_SYSTEMCTL_LOG) {
	fs.appendFileSync(process.env.MOCK_SYSTEMCTL_LOG, args.join(" ") + "\n");
}
let code = 0;
if (args.join(" ") === "is-active touch-timeout.service") {
	const state = process.env.MOCK_TOUCH_TIMEOUT || "inactive";
	process.stdout.write(state + "\n");
	if (state !== "active") code = 3;
}
if (args.join(" ") === "show -p ExecStart --value touch-timeout.service") {
	process.stdout.write((process.env.MOCK_TOUCH_TIMEOUT_EXECSTART || DROP_IN_EXECSTART) + "\n");
}
if (process.env.MOCK_SYSTEMCTL_EXIT) code = parseInt(process.env.MOCK_SYSTEMCTL_EXIT, 10);
process.exitCode = code;
