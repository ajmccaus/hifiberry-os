#!/usr/bin/env node
/* Mock systemctl for Beocreate-on-Debian tests (ADR 0002).

The server runs `$BEO_SYSTEMCTL <args>` (no shell); the tests point
BEO_SYSTEMCTL at this script. Each call appends its arguments, space-joined,
as one line to the file named by MOCK_SYSTEMCTL_LOG (if set), then:
  is-active touch-timeout.service
      prints the unit's ActiveState and exits 0 only for "active", as
      systemctl does: "activating" while a slow try-restart (below) runs,
      else MOCK_TOUCH_TIMEOUT (default "inactive": direct mode; "active":
      daemon mode)
  show -p ExecStart --value touch-timeout.service
      prints MOCK_TOUCH_TIMEOUT_EXECSTART, default the ExecStart of the
      shipped drop-in (package/touch-timeout-brightness.conf, read at each
      call) as systemd stores it, variables unexpanded
  try-restart touch-timeout.service
      with MOCK_TRY_RESTART_MS and an active unit: the unit reads
      "activating" for that long and the call returns when it is over
      (systemctl waits for the job)
  anything else: prints nothing and exits 0.
MOCK_SYSTEMCTL_EXIT, if set, is the exit code of every call instead
(systemctl failing, e.g. no systemd).
*/

const fs = require("fs");
const path = require("path");

const DROP_IN = path.join(__dirname, "..", "package", "touch-timeout-brightness.conf");
const RESTARTING = process.env.MOCK_SYSTEMCTL_LOG ? process.env.MOCK_SYSTEMCTL_LOG + ".restarting" : null;

function dropInExecStart() {
	const lines = fs.readFileSync(DROP_IN, "utf8").split("\n").filter(line => /^ExecStart=\S/.test(line));
	const command = lines[lines.length - 1].slice("ExecStart=".length).trim();
	return "{ path=" + command.split(/\s+/)[0] + " ; argv[]=" + command + " ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }";
}

const args = process.argv.slice(2);
const call = args.join(" ");
if (process.env.MOCK_SYSTEMCTL_LOG) {
	fs.appendFileSync(process.env.MOCK_SYSTEMCTL_LOG, call + "\n");
}
const configured = process.env.MOCK_TOUCH_TIMEOUT || "inactive";
let code = 0;
if (call === "is-active touch-timeout.service") {
	const state = (RESTARTING && fs.existsSync(RESTARTING)) ? "activating" : configured;
	process.stdout.write(state + "\n");
	if (state !== "active") code = 3;
}
if (call === "show -p ExecStart --value touch-timeout.service") {
	process.stdout.write((process.env.MOCK_TOUCH_TIMEOUT_EXECSTART || dropInExecStart()) + "\n");
}
if (call === "try-restart touch-timeout.service" && process.env.MOCK_TRY_RESTART_MS && RESTARTING && configured === "active") {
	fs.writeFileSync(RESTARTING, "");
	setTimeout(() => fs.rmSync(RESTARTING, {force: true}), parseInt(process.env.MOCK_TRY_RESTART_MS, 10));
}
if (process.env.MOCK_SYSTEMCTL_EXIT) code = parseInt(process.env.MOCK_SYSTEMCTL_EXIT, 10);
process.exitCode = code;
