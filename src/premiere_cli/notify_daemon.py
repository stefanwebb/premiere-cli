"""Standalone always-on-top notification daemon for `desktop-notify` /
`desktop-dismiss-notifications`.

`desktop_overlay.Overlay` lives only as long as the `desktop-*` command's
own process — fine for a status banner shown while that one command drives
Premiere, but `desktop-notify` needs the window to OUTLIVE the CLI
invocation that created it, so a later `desktop-notify` (a separate
process) can update the SAME window in place, and `desktop-dismiss-
notifications` can close it. That requires a persistent process; this is
it.

Talks over a tiny local HTTP server on `NOTIFY_DAEMON_PORT`:

  POST /update {"message": "...", "state": "waiting"|"driving"|"done"|"info"}
      Updates the visible text/color.
  POST /quit {}
      Hides the window and exits the process.

Run via `python3 -m premiere_cli.notify_daemon` (spawned detached by
`desktop_driver.notify`) — never imported for its side effects; only
`NOTIFY_DAEMON_PORT` is meant to be imported directly.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from premiere_cli import desktop_overlay

NOTIFY_DAEMON_PORT = 47824

_lock = threading.Lock()
_pending_update = None  # (message, state) tuple, or None
_quit_requested = False


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # keep stdout clean — callers only care about their own command's JSON

    def _reply(self, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        global _pending_update, _quit_requested
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            body = {}

        if self.path == "/update":
            with _lock:
                _pending_update = (body.get("message", ""), body.get("state", "info"))
            self._reply({"ok": True})
        elif self.path == "/quit":
            with _lock:
                _quit_requested = True
            self._reply({"ok": True})
        else:
            self.send_response(404)
            self.end_headers()


def _serve():
    # daemon thread: only ever sets flags under `_lock`, never touches Cocoa —
    # every AppKit call happens on the main thread in `main()`'s own loop.
    HTTPServer(("127.0.0.1", NOTIFY_DAEMON_PORT), _Handler).serve_forever()


def main():
    global _pending_update, _quit_requested

    threading.Thread(target=_serve, daemon=True).start()

    overlay = desktop_overlay.Overlay()

    while True:
        with _lock:
            update, _pending_update = _pending_update, None
            quit_now = _quit_requested

        if update is not None:
            message, state = update
            overlay.notify(message, state)

        if quit_now:
            overlay.hide()
            break

        overlay.sleep(0.1)


if __name__ == "__main__":
    main()
