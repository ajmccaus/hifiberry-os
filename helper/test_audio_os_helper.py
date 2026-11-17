"""Tests for audio_os_helper: real server on loopback, fake systemctl, backlight dir and ACR."""
from __future__ import annotations

import http.client
import json
import socket
import stat
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Callable

import audio_os_helper as helper

API = helper.API


class FakeAcr(HTTPServer):
    state = "stopped"
    status = 200

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = json.dumps({"state": self.server.state}).encode()  # type: ignore[attr-defined]
            self.send_response(self.server.status)  # type: ignore[attr-defined]
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: Any) -> None:
            pass


def wait_for(condition: Callable[[], bool], timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.01)
    return condition()


class HelperCase(unittest.TestCase):
    max_brightness: str | None = "255"
    with_backlight = True
    prepare: Callable[[Path], None] | None = None

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.state = root / "state"
        self.state.mkdir()
        self.backlight = root / "backlight"
        self.backlight.mkdir()
        if self.with_backlight:
            (self.backlight / "rpi_backlight").mkdir()
            if self.max_brightness is not None:
                (self.backlight / "rpi_backlight" / "max_brightness").write_text(self.max_brightness)
        self.calls = root / "systemctl.log"
        self.fail_flag = root / "fail"
        script = root / "systemctl"
        script.write_text(f'#!/bin/sh\necho "$@" >> "{self.calls}"\n[ -e "{self.fail_flag}" ] && exit 1\nexit 0\n')
        script.chmod(script.stat().st_mode | stat.S_IXUSR)
        self.version_file = root / "version"
        self.acr = FakeAcr(("127.0.0.1", 0), FakeAcr.Handler)
        threading.Thread(target=self.acr.serve_forever, daemon=True).start()
        self.addCleanup(self.acr.server_close)
        self.addCleanup(self.acr.shutdown)
        if self.prepare:
            self.prepare(self.state)
        self.start_server(script)

    def start_server(self, script: Path) -> None:
        env = {
            "AUDIO_OS_STATE_DIR": str(self.state),
            "AUDIO_OS_BACKLIGHT_DIR": str(self.backlight),
            "AUDIO_OS_SYSTEMCTL": str(script),
            "AUDIO_OS_ACR_URL": f"http://127.0.0.1:{self.acr.server_address[1]}",
            "AUDIO_OS_VERSION_FILE": str(self.version_file),
            "AUDIO_OS_PORT": "0",
            "AUDIO_OS_ACR_POLL_SECONDS": "0.02",
        }
        self.app = helper.App(helper.Config.from_env(env))
        self.server = helper.make_server(self.app, 0)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        threading.Thread(target=self.app.poll_acr, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.app.stop.set)

    def systemctl_calls(self) -> list[str]:
        try:
            return self.calls.read_text().splitlines()
        except FileNotFoundError:
            return []

    def request(self, method: str, path: str, body: Any = None, headers: dict[str, str] | None = None,
                raw: bytes | None = None, json_type: bool = True) -> tuple[int, Any, http.client.HTTPResponse]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        hdrs = dict(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if method != "GET" and json_type:
            hdrs.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=data, headers=hdrs)
        resp = conn.getresponse()
        payload = resp.read()
        conn.close()
        return resp.status, (json.loads(payload) if payload else None), resp

    def put_screen(self, body: Any) -> tuple[int, Any, http.client.HTTPResponse]:
        return self.request("PUT", f"{API}/screen", body)

    def env_file(self) -> str:
        return (self.state / "touch-timeout.env").read_text()


class ScreenTests(HelperCase):
    def test_defaults(self) -> None:
        status, body, _ = self.request("GET", f"{API}/screen")
        self.assertEqual((status, body), (200, {"available": True, "brightness": 60, "timeout": 300}))

    def test_startup_renders_env_and_try_restarts_once(self) -> None:
        self.assertEqual(self.env_file(), "TOUCH_TIMEOUT_ARGS=-b 153 -t 300\n")
        self.assertEqual(self.systemctl_calls(), ["try-restart touch-timeout.service"])

    def test_put_persists_and_restarts_once_per_change(self) -> None:
        status, body, _ = self.put_screen({"brightness": 100, "timeout": 120})
        self.assertEqual((status, body), (200, {"available": True, "brightness": 100, "timeout": 120}))
        self.assertEqual(self.env_file(), "TOUCH_TIMEOUT_ARGS=-b 255 -t 120\n")
        self.assertEqual(len(self.systemctl_calls()), 2)  # startup + this change
        self.put_screen({"brightness": 100, "timeout": 120})
        self.put_screen({"timeout": 120})
        self.assertEqual(len(self.systemctl_calls()), 2)  # unchanged => no restart
        self.assertEqual(json.loads((self.state / "screen.json").read_text()),
                         {"brightness": 100, "timeout": 120})
        self.assertFalse(any(c.startswith("start") for c in self.systemctl_calls()))

    def test_partial_put_keeps_other_value(self) -> None:
        self.put_screen({"timeout": 600})
        _, body, _ = self.request("GET", f"{API}/screen")
        self.assertEqual((body["brightness"], body["timeout"]), (60, 600))

    def test_validation(self) -> None:
        for bad in ({}, {"brightness": 0}, {"brightness": 101}, {"brightness": 50.5}, {"brightness": "50"},
                    {"brightness": True}, {"timeout": 29}, {"timeout": 86401}, {"timeout": None},
                    {"brightness": 50, "extra": 1}, [1], "x", 5):
            with self.subTest(bad=bad):
                status, body, _ = self.put_screen(bad)
                self.assertEqual(status, 400)
                self.assertIn("error", body)
        self.assertEqual(len(self.systemctl_calls()), 1)

    def test_wake(self) -> None:
        status, body, _ = self.request("POST", f"{API}/screen/wake")
        self.assertEqual((status, body), (204, None))
        self.assertEqual(self.systemctl_calls()[-1], "kill --signal=SIGUSR1 touch-timeout.service")

    def test_failing_systemctl_is_500_without_internals(self) -> None:
        self.fail_flag.touch()
        status, body, _ = self.request("POST", f"{API}/screen/wake")
        self.assertEqual((status, body), (500, {"error": "system command failed"}))
        status, body, _ = self.put_screen({"brightness": 10})
        self.assertEqual((status, body), (500, {"error": "system command failed"}))


class MaxBrightness255Tests(HelperCase):
    def test_mapping(self) -> None:
        for pct, raw in ((1, 15), (60, 153), (100, 255)):
            self.put_screen({"brightness": pct})
            self.assertEqual(self.env_file(), f"TOUCH_TIMEOUT_ARGS=-b {raw} -t 300\n")


class MaxBrightness31Tests(HelperCase):
    max_brightness = "31"

    def test_capped_at_panel_max(self) -> None:
        for pct, raw in ((1, 15), (60, 31), (100, 31)):
            self.put_screen({"brightness": pct})
            self.assertEqual(self.env_file(), f"TOUCH_TIMEOUT_ARGS=-b {raw} -t 300\n")


class MissingMaxBrightnessTests(HelperCase):
    max_brightness = None

    def test_falls_back_to_255(self) -> None:
        self.put_screen({"brightness": 100})
        self.assertEqual(self.env_file(), "TOUCH_TIMEOUT_ARGS=-b 255 -t 300\n")


class NoBacklightTests(HelperCase):
    with_backlight = False

    def test_unavailable_and_no_systemctl(self) -> None:
        _, body, _ = self.request("GET", f"{API}/screen")
        self.assertFalse(body["available"])
        status, body, _ = self.put_screen({"brightness": 80})
        self.assertEqual(status, 200)
        self.assertEqual((body["available"], body["brightness"]), (False, 80))
        self.assertEqual(self.systemctl_calls(), [])
        self.assertFalse((self.state / "touch-timeout.env").exists())


def _corrupt(state: Path) -> None:
    (state / "screen.json").write_text("{not json")
    (state / "radio.json").write_bytes(b"\xff\xfe")


class CorruptStateTests(HelperCase):
    prepare = staticmethod(_corrupt)

    def test_falls_back_to_defaults(self) -> None:
        _, screen, _ = self.request("GET", f"{API}/screen")
        self.assertEqual((screen["brightness"], screen["timeout"]), (60, 300))
        _, radio, _ = self.request("GET", f"{API}/radio")
        self.assertEqual(radio, {"stations": []})


def _bad_values(state: Path) -> None:
    (state / "screen.json").write_text('{"brightness": 500, "timeout": 90}')
    (state / "radio.json").write_text('{"stations": [{"name": "no url"}]}')


class InvalidStateValuesTests(HelperCase):
    prepare = staticmethod(_bad_values)

    def test_invalid_values_replaced_individually(self) -> None:
        _, screen, _ = self.request("GET", f"{API}/screen")
        self.assertEqual((screen["brightness"], screen["timeout"]), (60, 90))
        _, radio, _ = self.request("GET", f"{API}/radio")
        self.assertEqual(radio, {"stations": []})


class RadioTests(HelperCase):
    STATION = {"id": "a", "name": "Jazz", "url": "https://x.example/stream", "favicon": "http://x.example/i.png"}

    def test_round_trip_preserves_order(self) -> None:
        second = {"id": "b", "name": "Rock", "url": "http://y.example/s", "favicon": ""}
        status, body, _ = self.request("PUT", f"{API}/radio", {"stations": [second, self.STATION]})
        self.assertEqual((status, body), (200, {"stations": [second, self.STATION]}))
        self.assertEqual(self.request("GET", f"{API}/radio")[1], {"stations": [second, self.STATION]})
        self.assertEqual(json.loads((self.state / "radio.json").read_text())["stations"][0]["id"], "b")

    def test_optional_fields_default_to_empty(self) -> None:
        _, body, _ = self.request("PUT", f"{API}/radio", {"stations": [{"url": "http://a.example/"}]})
        self.assertEqual(body["stations"], [{"id": "", "name": "", "url": "http://a.example/", "favicon": ""}])

    def test_validation(self) -> None:
        s = self.STATION
        bad_lists: list[Any] = [
            "x", None, {"a": 1}, [s] * 201,
            [{**s, "url": "ftp://x.example/"}], [{**s, "url": "javascript:alert(1)"}], [{**s, "url": ""}],
            [{**s, "url": "http://"}], [{**s, "url": 5}], [{**s, "favicon": "data:image/png;base64,AA"}],
            [{**s, "favicon": 7}], [{**s, "name": "n" * 201}], [{**s, "name": 3}], [{**s, "id": None}],
            [{**s, "url": "http://x.example/" + "a" * 2000}], [{**s, "favicon": "http://x.example/" + "a" * 2000}],
            [{k: v for k, v in s.items() if k != "url"}], [{**s, "extra": "x"}], ["str"],
        ]
        for stations in bad_lists:
            with self.subTest(stations=str(stations)[:60]):
                self.assertEqual(self.request("PUT", f"{API}/radio", {"stations": stations})[0], 400)
        self.assertEqual(self.request("PUT", f"{API}/radio", {"stations": [], "x": 1})[0], 400)
        self.assertEqual(self.request("GET", f"{API}/radio")[1], {"stations": []})

    def test_limit_boundary_accepted(self) -> None:
        stations = [{**self.STATION, "name": "n" * 200} for _ in range(200)]
        self.assertEqual(self.request("PUT", f"{API}/radio", {"stations": stations})[0], 200)


class PowerInfoTests(HelperCase):
    def test_power_argv(self) -> None:
        for action, verb in (("restart", "reboot"), ("shutdown", "poweroff")):
            status, _, _ = self.request("POST", f"{API}/power", {"action": action})
            self.assertEqual(status, 202)
            self.assertEqual(self.systemctl_calls()[-1], verb)

    def test_power_rejects_other_actions(self) -> None:
        before = len(self.systemctl_calls())
        for bad in ({"action": "halt"}, {"action": 1}, {}, {"action": "restart", "x": 1}):
            self.assertEqual(self.request("POST", f"{API}/power", bad)[0], 400)
        self.assertEqual(len(self.systemctl_calls()), before)

    def test_power_failure_is_500(self) -> None:
        self.fail_flag.touch()
        self.assertEqual(self.request("POST", f"{API}/power", {"action": "restart"})[0], 500)

    def test_info_version(self) -> None:
        self.assertEqual(self.request("GET", f"{API}/info")[1], {"version": "unknown"})
        self.version_file.write_text("1.2.3\n")
        self.assertEqual(self.request("GET", f"{API}/info")[1], {"version": "1.2.3"})


class ProtocolTests(HelperCase):
    def test_unknown_path_404(self) -> None:
        for path in (f"{API}/nope", f"{API}/screen/", "/", f"{API}"):
            self.assertEqual(self.request("GET", path)[0], 404)

    def test_wrong_method_405_with_allow(self) -> None:
        status, _, resp = self.request("DELETE", f"{API}/screen")
        self.assertEqual((status, resp.getheader("Allow")), (405, "GET, PUT"))
        status, _, resp = self.request("GET", f"{API}/power")
        self.assertEqual((status, resp.getheader("Allow")), (405, "POST"))
        self.assertEqual(self.request("POST", f"{API}/info", {})[0], 405)

    def test_content_type_enforced(self) -> None:
        self.assertEqual(self.request("PUT", f"{API}/screen", {"brightness": 5}, json_type=False)[0], 403)
        self.assertEqual(self.request("PUT", f"{API}/screen", {"brightness": 5},
                                      headers={"Content-Type": "text/plain"})[0], 403)
        self.assertEqual(self.request("PUT", f"{API}/screen", {"brightness": 5},
                                      headers={"Content-Type": "application/json; charset=utf-8"})[0], 200)
        self.assertEqual(self.request("POST", f"{API}/screen/wake", json_type=False)[0], 403)

    def test_origin_must_match_host(self) -> None:
        host = f"127.0.0.1:{self.port}"
        ok = self.request("PUT", f"{API}/screen", {"brightness": 5}, headers={"Origin": f"http://{host}"})
        self.assertEqual(ok[0], 200)
        bad = self.request("PUT", f"{API}/screen", {"brightness": 6}, headers={"Origin": "http://evil.example"})
        self.assertEqual(bad[0], 403)
        self.assertEqual(self.request("GET", f"{API}/screen")[1]["brightness"], 5)

    def test_invalid_json_400(self) -> None:
        for raw in (b"{", b"", b"\xff", b"[]", b"null", b"[" * 50000):
            with self.subTest(raw=raw[:10]):
                status, body, _ = self.request("PUT", f"{API}/screen", raw=raw)
                self.assertEqual(status, 400)
                self.assertIn("error", body)

    def test_oversized_body_413(self) -> None:
        status, body, _ = self.request("PUT", f"{API}/radio", raw=b" " * (helper.MAX_BODY + 1))
        self.assertEqual((status, "error" in body), (413, True))
        self.assertEqual(self.request("PUT", f"{API}/screen", raw=b'{"brightness": 7}' + b" " * 1000)[0], 200)

    def test_bad_content_length_400(self) -> None:
        for value in ("abc", "-1"):
            with socket.create_connection(("127.0.0.1", self.port), timeout=5) as sock:
                sock.sendall(f"PUT {API}/screen HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
                             f"Content-Length: {value}\r\n\r\n".encode())
                self.assertIn(b" 400 ", sock.recv(4096).split(b"\r\n")[0])

    def test_keep_alive_and_content_length(self) -> None:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        for _ in range(3):
            conn.request("GET", f"{API}/screen")
            resp = conn.getresponse()
            self.assertEqual(resp.version, 11)
            self.assertEqual(int(resp.getheader("Content-Length")), len(resp.read()))
        conn.request("POST", f"{API}/nope", body=b"{}", headers={"Content-Type": "application/json"})
        conn.getresponse().read()  # unread body of an error response must not desync the connection
        conn.request("GET", f"{API}/info")
        self.assertEqual(conn.getresponse().status, 200)
        conn.close()

    def test_listens_on_loopback_only(self) -> None:
        self.assertEqual(self.server.server_address[0], "127.0.0.1")


class WakeOnPlayTests(HelperCase):
    def wakes(self) -> int:
        return sum(1 for c in self.systemctl_calls() if c.startswith("kill "))

    def set_acr(self, state: str, status: int = 200) -> None:
        self.acr.state, self.acr.status = state, status

    def test_fires_once_per_transition(self) -> None:
        time.sleep(0.2)  # many polls while stopped
        self.assertEqual(self.wakes(), 0)
        self.set_acr("playing")
        self.assertTrue(wait_for(lambda: self.wakes() == 1))
        time.sleep(0.3)  # many polls while still playing
        self.assertEqual(self.wakes(), 1)
        self.set_acr("paused")
        time.sleep(0.1)
        self.set_acr("Playing")
        self.assertTrue(wait_for(lambda: self.wakes() == 2))

    def test_acr_down_is_not_playing(self) -> None:
        self.set_acr("playing", 500)
        time.sleep(0.2)
        self.assertEqual(self.wakes(), 0)
        self.set_acr("playing", 200)
        self.assertTrue(wait_for(lambda: self.wakes() == 1))


if __name__ == "__main__":
    unittest.main()
