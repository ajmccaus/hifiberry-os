#!/usr/bin/env python3
"""audio-os-helper: loopback device API (screen, radio favourites, power, info) behind nginx.
Binds 127.0.0.1 only; every subprocess is an argv list; state files are written atomically."""
from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import threading
import urllib.request
from dataclasses import dataclass
from http import HTTPStatus
from http.client import HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

log = logging.getLogger("audio-os-helper")

API = "/api/device/v1"
MAX_BODY = 64 * 1024
MAX_STATIONS = 200
DEFAULT_BRIGHTNESS, DEFAULT_TIMEOUT = 60, 300
RAW_MIN, RAW_MAX = 15, 255  # touch-timeout -b range (src/main.c MIN_/MAX_BRIGHTNESS)
SUBPROCESS_TIMEOUT = 10
STATION_LIMITS = {"id": 200, "name": 200, "url": 2000, "favicon": 2000}


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Config:
    state_dir: Path
    backlight_dir: Path
    systemctl: str
    acr_url: str
    version_file: Path
    port: int
    poll_seconds: float

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Config:
        return cls(
            state_dir=Path(env.get("AUDIO_OS_STATE_DIR", "/var/lib/audio-os")),
            backlight_dir=Path(env.get("AUDIO_OS_BACKLIGHT_DIR", "/sys/class/backlight")),
            systemctl=env.get("AUDIO_OS_SYSTEMCTL", "/usr/bin/systemctl"),
            acr_url=env.get("AUDIO_OS_ACR_URL", "http://127.0.0.1:1080").rstrip("/"),
            version_file=Path(env.get("AUDIO_OS_VERSION_FILE", "/usr/share/audio-os/version")),
            port=int(env.get("AUDIO_OS_PORT", "1090")),
            poll_seconds=float(env.get("AUDIO_OS_ACR_POLL_SECONDS", "2")),
        )


def check_int(value: Any, lo: int, hi: int, name: str) -> int:
    if type(value) is not int or not lo <= value <= hi:  # bool is not accepted
        raise ApiError(400, f"{name} must be an integer {lo}-{hi}")
    return value


def check_http_url(value: Any, name: str, limit: int, required: bool) -> str:
    if not isinstance(value, str) or len(value) > limit:
        raise ApiError(400, f"{name} must be a string of at most {limit} characters")
    if not value and not required:
        return value
    try:
        parts = urlsplit(value)
    except ValueError:
        raise ApiError(400, f"{name} is not a valid URL") from None
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ApiError(400, f"{name} must be an http or https URL")
    return value


def check_station(item: Any) -> dict[str, str]:
    if not isinstance(item, dict) or not set(item) <= set(STATION_LIMITS) or "url" not in item:
        raise ApiError(400, "each station must be an object with a url and only id, name, url, favicon")
    station = {}
    for key, limit in STATION_LIMITS.items():
        value = item.get(key, "")
        if key in ("url", "favicon"):
            value = check_http_url(value, key, limit, required=key == "url")
        elif not isinstance(value, str) or len(value) > limit:
            raise ApiError(400, f"{key} must be a string of at most {limit} characters")
        station[key] = value
    return station


def check_stations(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list) or len(value) > MAX_STATIONS:
        raise ApiError(400, f"stations must be a list of at most {MAX_STATIONS}")
    return [check_station(item) for item in value]


def raw_brightness(percent: int, hw_max: int) -> int:
    return min(hw_max, max(RAW_MIN, (percent * RAW_MAX + 50) // 100))


def write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    dir_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


class App:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.lock = threading.Lock()
        self.stop = threading.Event()
        cfg.state_dir.mkdir(parents=True, exist_ok=True)
        self.screen = self._load_screen()
        self.stations = self._load_stations()
        try:
            self._apply_touch_timeout()
        except ApiError:
            pass  # already logged; the service keeps its previous settings

    # --- state ---
    def _read_json(self, name: str) -> Any:
        path = self.cfg.state_dir / name
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            log.warning("state file %s unreadable; using defaults", name)
            return None

    def _load_screen(self) -> dict[str, int]:
        saved = self._read_json("screen.json")
        saved = saved if isinstance(saved, dict) else {}
        screen = {"brightness": DEFAULT_BRIGHTNESS, "timeout": DEFAULT_TIMEOUT}
        for key, lo, hi in (("brightness", 1, 100), ("timeout", 30, 86400)):
            if key in saved:
                try:
                    screen[key] = check_int(saved[key], lo, hi, key)
                except ApiError:
                    log.warning("screen.json has an invalid %s; using default", key)
        return screen

    def _load_stations(self) -> list[dict[str, str]]:
        saved = self._read_json("radio.json")
        try:
            return check_stations(saved["stations"]) if saved is not None else []
        except (ApiError, KeyError, TypeError):
            log.warning("radio.json invalid; using empty list")
            return []

    # --- screen ---
    def backlight(self) -> Path | None:
        """First valid entry, as touch-timeout's find_backlight_device does."""
        try:
            names = sorted(os.listdir(self.cfg.backlight_dir))
        except OSError:
            return None
        for name in names:
            if name and not name.startswith(".") and ".." not in name and len(name) < 64:
                return self.cfg.backlight_dir / name
        return None

    def _hw_max(self, device: Path) -> int:
        try:
            value = int((device / "max_brightness").read_text())
        except (OSError, ValueError):
            return RAW_MAX
        return value if value > 0 else RAW_MAX

    def _apply_touch_timeout(self) -> None:
        """Render the env file; try-restart touch-timeout only if its content changed."""
        device = self.backlight()
        if device is None:
            return
        raw = raw_brightness(self.screen["brightness"], self._hw_max(device))
        content = f"TOUCH_TIMEOUT_ARGS=-b {raw} -t {self.screen['timeout']}\n"
        path = self.cfg.state_dir / "touch-timeout.env"
        try:
            if path.read_text(encoding="utf-8") == content:
                return
        except OSError:
            pass
        write_atomic(path, content)
        self.systemctl("try-restart", "touch-timeout.service")

    def get_screen(self) -> dict[str, Any]:
        return {"available": self.backlight() is not None, **self.screen}

    def put_screen(self, body: dict[str, Any]) -> dict[str, Any]:
        ranges = {"brightness": (1, 100), "timeout": (30, 86400)}
        if not body or not set(body) <= set(ranges):
            raise ApiError(400, "body must contain brightness and/or timeout")
        update = {k: check_int(v, *ranges[k], k) for k, v in body.items()}
        with self.lock:
            self.screen.update(update)
            write_atomic(self.cfg.state_dir / "screen.json", json.dumps(self.screen))
            self._apply_touch_timeout()
        log.info("screen set %s", self.screen)
        return self.get_screen()

    # --- radio ---
    def put_radio(self, body: dict[str, Any]) -> dict[str, Any]:
        if set(body) != {"stations"}:
            raise ApiError(400, "body must be {\"stations\": [...]}")
        stations = check_stations(body["stations"])
        with self.lock:
            write_atomic(self.cfg.state_dir / "radio.json", json.dumps({"stations": stations}))
            self.stations = stations
        log.info("radio favourites set count=%d", len(stations))
        return {"stations": stations}

    # --- system ---
    def systemctl(self, *args: str) -> None:
        """Run systemctl; raises ApiError(500) without leaking internals."""
        try:
            done = subprocess.run([self.cfg.systemctl, *args], capture_output=True,
                                  timeout=SUBPROCESS_TIMEOUT, check=False)
        except (OSError, subprocess.SubprocessError) as exc:
            log.error("systemctl %s failed: %s", args[0], type(exc).__name__)
            raise ApiError(500, "system command failed") from None
        if done.returncode != 0:
            log.error("systemctl %s exited %d", args[0], done.returncode)
            raise ApiError(500, "system command failed")

    def wake(self) -> None:
        self.systemctl("kill", "--signal=SIGUSR1", "touch-timeout.service")

    def power(self, body: dict[str, Any]) -> None:
        verbs = {"restart": "reboot", "shutdown": "poweroff"}
        if set(body) != {"action"} or body["action"] not in verbs:
            raise ApiError(400, "action must be \"restart\" or \"shutdown\"")
        log.info("power %s requested", body["action"])
        self.systemctl(verbs[body["action"]])

    def info(self) -> dict[str, str]:
        try:
            version = self.cfg.version_file.read_text(encoding="utf-8").strip()
        except OSError:
            version = ""
        return {"version": version or "unknown"}

    # --- wake on play ---
    def is_playing(self) -> bool | None:
        """None when ACR is unreachable."""
        try:
            with urllib.request.urlopen(self.cfg.acr_url + "/api/now-playing", timeout=1.5) as resp:
                data = json.loads(resp.read(1 << 20))
        except (OSError, HTTPException, ValueError):
            return None
        # Top-level "state": acr/doc/api.md:647. The enum serialises lowercase
        # ("playing"; acr/crates/acr-types/src/playback_state.rs:10) though the doc shows "Playing".
        state = data.get("state") if isinstance(data, dict) else None
        return isinstance(state, str) and state.lower() == "playing"

    def poll_acr(self) -> None:
        playing, reachable = False, True
        while not self.stop.wait(self.cfg.poll_seconds):
            now = self.is_playing()
            if (now is not None) != reachable:
                reachable = now is not None
                log.info("ACR %s", "reachable" if reachable else "unreachable")
            if now and not playing:
                try:
                    self.wake()
                except ApiError:
                    pass  # already logged
            playing = bool(now)


Route = Callable[[App, dict[str, Any]], "tuple[int, Any]"]

ROUTES: dict[str, dict[str, Route]] = {
    f"{API}/screen": {"GET": lambda a, b: (200, a.get_screen()),
                      "PUT": lambda a, b: (200, a.put_screen(b))},
    f"{API}/screen/wake": {"POST": lambda a, b: (a.wake() or 204, None)},
    f"{API}/radio": {"GET": lambda a, b: (200, {"stations": a.stations}),
                     "PUT": lambda a, b: (200, a.put_radio(b))},
    f"{API}/power": {"POST": lambda a, b: (a.power(b) or 202, {"status": "accepted"})},
    f"{API}/info": {"GET": lambda a, b: (200, a.info())},
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "audio-os-helper"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        pass  # state-changing requests are logged by App

    def _send(self, status: int, payload: Any = None, extra: Mapping[str, str] | None = None) -> None:
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        if status != HTTPStatus.NO_CONTENT:
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def _read_body(self) -> bytes:
        if "Transfer-Encoding" in self.headers:
            self.close_connection = True
            raise ApiError(400, "chunked bodies are not supported")
        raw = self.headers.get("Content-Length", "0")
        if not raw.isascii() or not raw.isdigit():
            self.close_connection = True
            raise ApiError(400, "invalid Content-Length")
        if int(raw) > MAX_BODY:
            self.close_connection = True
            raise ApiError(413, "body too large")
        return self.rfile.read(int(raw))

    def _check_origin(self) -> None:
        if self.headers.get_content_type() != "application/json":
            raise ApiError(403, "Content-Type must be application/json")
        origin = self.headers.get("Origin")
        if origin is not None and urlsplit(origin).netloc != self.headers.get("Host"):
            raise ApiError(403, "cross-origin request refused")

    def _parse_json(self, raw: bytes) -> dict[str, Any]:
        if not raw:
            return {}
        try:
            body = json.loads(raw)
        except (ValueError, RecursionError):
            raise ApiError(400, "body is not valid JSON") from None
        if not isinstance(body, dict):
            raise ApiError(400, "body must be a JSON object")
        return body

    def _dispatch(self) -> None:
        app: App = self.server.app  # type: ignore[attr-defined]
        try:
            raw = self._read_body()
            methods = ROUTES.get(urlsplit(self.path).path)
            if methods is None:
                raise ApiError(404, "not found")
            handler = methods.get(self.command)
            if handler is None:
                self._send(405, {"error": "method not allowed"}, {"Allow": ", ".join(methods)})
                return
            if self.command != "GET":
                self._check_origin()
            status, payload = handler(app, self._parse_json(raw) if self.command != "GET" else {})
            self._send(status, payload)
        except ApiError as err:
            self._send(err.status, {"error": str(err)})
        except Exception:
            log.exception("unhandled error")
            self._send(500, {"error": "internal error"})

    do_GET = do_PUT = do_POST = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _dispatch


def make_server(app: App, port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.app = app  # type: ignore[attr-defined]
    return server


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    app = App(Config.from_env(os.environ))
    server = make_server(app, app.cfg.port)
    threading.Thread(target=app.poll_acr, daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown).start())
    log.info("listening on 127.0.0.1:%d", server.server_address[1])
    try:
        server.serve_forever()
    finally:
        app.stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
