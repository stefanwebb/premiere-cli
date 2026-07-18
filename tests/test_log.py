import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from premiere_bridge import log as premiere_log


class _RecordingHandler(BaseHTTPRequestHandler):
    received = []
    response_body = {"ok": True}
    response_status = 200

    def do_POST(self):
        import json

        length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(length))
        _RecordingHandler.received.append((self.path, body))
        self.send_response(_RecordingHandler.response_status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(_RecordingHandler.response_body).encode("utf-8"))

    def log_message(self, format, *args):
        pass


@pytest.fixture
def fake_panel():
    _RecordingHandler.received = []
    _RecordingHandler.response_body = {"ok": True}
    _RecordingHandler.response_status = 200
    server = HTTPServer(("127.0.0.1", 0), _RecordingHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield port
    server.shutdown()
    thread.join()


@pytest.fixture
def unused_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_log_posts_message_level_and_source(fake_panel):
    premiere_log.log("hello", level="warn", source="test", port=fake_panel)

    path, body = _RecordingHandler.received[0]
    assert path == "/log"
    assert body == {"message": "hello", "level": "warn", "source": "test"}


def test_log_defaults_level_to_info_and_omits_source(fake_panel):
    premiere_log.log("hi", port=fake_panel)

    _, body = _RecordingHandler.received[0]
    assert body == {"message": "hi", "level": "info"}


def test_log_rejects_invalid_level():
    with pytest.raises(ValueError, match="level must be one of"):
        premiere_log.log("hi", level="debug", port=1)


def test_log_raises_runtime_error_when_panel_returns_ok_false(fake_panel):
    _RecordingHandler.response_body = {"ok": False, "error": "message is required"}

    with pytest.raises(RuntimeError, match="message is required"):
        premiere_log.log("hi", port=fake_panel)


def test_log_raises_runtime_error_on_http_400(fake_panel):
    _RecordingHandler.response_status = 400
    _RecordingHandler.response_body = {"ok": False, "error": "invalid JSON"}

    with pytest.raises(RuntimeError, match="invalid JSON"):
        premiere_log.log("hi", port=fake_panel)


def test_log_raises_connection_error_when_panel_not_running(unused_port):
    with pytest.raises(ConnectionError, match="could not reach"):
        premiere_log.log("hi", port=unused_port)


def test_main_exits_1_and_prints_error_on_failure(monkeypatch, capsys, unused_port):
    monkeypatch.setattr(sys, "argv", ["premiere-log", "hi", "--port", str(unused_port)])

    with pytest.raises(SystemExit) as exc_info:
        premiere_log.main()

    assert exc_info.value.code == 1
    captured = capsys.readouterr()
    assert "Error:" in captured.err


def test_main_succeeds_silently_when_panel_reachable(monkeypatch, capsys, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-log", "hi", "--port", str(fake_panel)])

    premiere_log.main()

    captured = capsys.readouterr()
    assert captured.err == ""
