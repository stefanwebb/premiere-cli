import json
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from premiere_bridge import cli as premiere_cli


class _RecordingHandler(BaseHTTPRequestHandler):
    received = []
    response_body = {"ok": True, "result": {"projects": []}}
    response_status = 200

    def do_POST(self):
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
    _RecordingHandler.response_body = {"ok": True, "result": {"projects": []}}
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


def test_submit_command_posts_command_and_args(fake_panel):
    premiere_cli.submit_command("get-project-info", args={"foo": "bar"}, port=fake_panel)

    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {"command": "get-project-info", "args": {"foo": "bar"}}


def test_submit_command_defaults_args_to_empty_dict(fake_panel):
    premiere_cli.submit_command("get-project-info", port=fake_panel)

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-project-info", "args": {}}


def test_submit_command_returns_result_on_success(fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"projects": [{"name": "vlog0002"}]}}

    result = premiere_cli.submit_command("get-project-info", port=fake_panel)

    assert result == {"ok": True, "result": {"projects": [{"name": "vlog0002"}]}}


def test_submit_command_returns_ok_false_from_panel(fake_panel):
    _RecordingHandler.response_body = {"ok": False, "error": "no project open"}

    result = premiere_cli.submit_command("get-project-info", port=fake_panel)

    assert result == {"ok": False, "error": "no project open"}


def test_submit_command_returns_error_dict_when_panel_unreachable(unused_port):
    result = premiere_cli.submit_command("get-project-info", port=unused_port)

    assert result["ok"] is False
    assert "could not reach" in result["error"]


def test_main_exits_0_and_prints_json_on_success(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"projects": []}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-project-info"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed == {"ok": True, "result": {"projects": []}}


def test_main_exits_1_and_prints_json_on_panel_failure(monkeypatch, capsys, unused_port):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(unused_port), "get-project-info"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 1
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is False
    assert "could not reach" in printed["error"]


def test_submit_command_returns_error_dict_when_response_is_non_dict_json(fake_panel):
    """Test that non-dict JSON responses are wrapped in an error dict."""
    _RecordingHandler.response_body = 42  # Not a dict

    result = premiere_cli.submit_command("get-project-info", port=fake_panel)

    assert isinstance(result, dict)
    assert result["ok"] is False
    assert "unexpected response" in result["error"]
    assert "42" in result["error"]


def test_submit_command_returns_error_dict_when_response_missing_ok_key(fake_panel):
    """Test that dict responses missing the 'ok' key are wrapped in an error dict."""
    _RecordingHandler.response_body = {"result": {"projects": []}}  # Missing 'ok' key

    result = premiere_cli.submit_command("get-project-info", port=fake_panel)

    assert isinstance(result, dict)
    assert result["ok"] is False
    assert "unexpected response" in result["error"]


def test_main_exits_1_and_prints_json_when_response_is_non_dict(monkeypatch, capsys, fake_panel):
    """Test that main() handles non-dict responses without raising AttributeError."""
    _RecordingHandler.response_body = 42  # Not a dict
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-project-info"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 1
    printed = json.loads(capsys.readouterr().out)
    assert isinstance(printed, dict)
    assert printed["ok"] is False
    assert "unexpected response" in printed["error"]


def test_main_create_sequence_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "name": "My Sequence",
            "bin": "B-Roll/Interviews",
            "sequenceID": "guid-123",
            "settingsApplied": ["fps", "resolution"],
            "settingsFailed": {},
            "colorSpace": "rec709 (implicit default, not explicitly set)",
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "create-sequence",
            "--name", "My Sequence",
            "--bin", "B-Roll/Interviews",
            "--fps", "25",
            "--width", "1920",
            "--height", "1080",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {
        "command": "create-sequence",
        "args": {"name": "My Sequence", "bin": "B-Roll/Interviews", "fps": 25.0, "width": 1920, "height": 1080},
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_create_sequence_defaults_to_4k_25fps(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "name": "My Sequence",
            "bin": "B-Roll/Interviews",
            "sequenceID": "guid-123",
            "settingsApplied": ["fps", "resolution"],
            "settingsFailed": {},
            "colorSpace": "rec709 (from bundled sequence preset)",
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "create-sequence",
            "--name", "My Sequence",
            "--bin", "B-Roll/Interviews",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "create-sequence",
        "args": {"name": "My Sequence", "bin": "B-Roll/Interviews", "fps": 25.0, "width": 3840, "height": 2160},
    }


def test_main_create_sequence_exits_1_on_duplicate(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": False,
        "error": 'sequence "My Sequence" already exists in bin "B-Roll/Interviews"',
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "create-sequence",
            "--name", "My Sequence",
            "--bin", "B-Roll/Interviews",
            "--fps", "25",
            "--width", "1920",
            "--height", "1080",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 1
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is False
    assert "already exists" in printed["error"]


def test_parse_intervals_file_parses_valid_lines(tmp_path):
    cuts_file = tmp_path / "main-mic.cuts.txt"
    cuts_file.write_text("00:12:05 - 00:12:08\n\n00:45:10 - 00:45:11\n")

    intervals = premiere_cli._parse_intervals_file(str(cuts_file))

    assert intervals == [
        {"start": "00:12:05", "end": "00:12:08"},
        {"start": "00:45:10", "end": "00:45:11"},
    ]


def test_parse_intervals_file_raises_on_malformed_line(tmp_path):
    cuts_file = tmp_path / "bad.cuts.txt"
    cuts_file.write_text("00:12:05 - 00:12:08\nnot a valid line\n")

    with pytest.raises(ValueError, match="not a valid line"):
        premiere_cli._parse_intervals_file(str(cuts_file))


def test_main_remove_track_intervals_sends_correct_args(monkeypatch, capsys, fake_panel, tmp_path):
    cuts_file = tmp_path / "main-mic.cuts.txt"
    cuts_file.write_text("00:12:05 - 00:12:08\n00:45:10 - 00:45:11\n")
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "sequenceName": "Sequence 01",
            "audioTrackIndex": 0,
            "videoTrackIndices": [0],
            "intervalsApplied": 2,
            "totalSegmentsRemoved": 4,
            "warnings": [],
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "remove-track-intervals",
            "--sequence-name", "Sequence 01",
            "--audio-track-index", "0",
            "--video-track-index", "0",
            "--intervals-file", str(cuts_file),
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "remove-track-intervals",
        "args": {
            "sequenceName": "Sequence 01",
            "audioTrackIndex": 0,
            "videoTrackIndices": [0],
            "intervals": [
                {"start": "00:12:05", "end": "00:12:08"},
                {"start": "00:45:10", "end": "00:45:11"},
            ],
        },
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_remove_track_intervals_defaults_video_track_indices_to_empty_list(monkeypatch, fake_panel, tmp_path):
    cuts_file = tmp_path / "main-mic.cuts.txt"
    cuts_file.write_text("00:12:05 - 00:12:08\n")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "remove-track-intervals",
            "--audio-track-index", "0",
            "--intervals-file", str(cuts_file),
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert "sequenceName" not in body["args"]
    assert body["args"]["videoTrackIndices"] == []


def test_main_remove_track_intervals_exits_2_on_malformed_intervals_file(monkeypatch, tmp_path):
    cuts_file = tmp_path / "bad.cuts.txt"
    cuts_file.write_text("nonsense\n")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "remove-track-intervals",
            "--audio-track-index", "0",
            "--intervals-file", str(cuts_file),
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_remove_track_intervals_exits_2_on_empty_intervals_file(monkeypatch, tmp_path):
    cuts_file = tmp_path / "empty.cuts.txt"
    cuts_file.write_text("")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "remove-track-intervals",
            "--audio-track-index", "0",
            "--intervals-file", str(cuts_file),
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_export_frame_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "sequenceName": "Sequence 01",
            "timecode": "00:12:05",
            "timeSeconds": 12.2,
            "outputPath": "/tmp/frame.png",
            "width": 3840,
            "height": 2160,
            "attempts": [{"args": ["/tmp/frame.png"], "success": True}],
            "succeededWithArgs": ["/tmp/frame.png"],
            "fileSizeBytes": 123456,
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "export-frame",
            "--output", "/tmp/frame.png",
            "--timecode", "00:12:05",
            "--sequence-name", "Sequence 01",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "export-frame",
        "args": {
            "outputPath": "/tmp/frame.png",
            "timecode": "00:12:05",
            "sequenceName": "Sequence 01",
        },
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_export_frame_omits_sequence_name_when_not_given(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "export-frame",
            "--output", "/tmp/frame.png",
            "--timecode", "00:12:05",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert "sequenceName" not in body["args"]
    assert body["args"]["outputPath"] == "/tmp/frame.png"
    assert body["args"]["timecode"] == "00:12:05"


def test_main_get_active_sequence_sends_no_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "name": "Sequence 01",
            "sequenceID": "guid-123",
            "frameRate": 25.0,
            "durationSeconds": 143.2,
            "width": 3840,
            "height": 2160,
            "videoTracks": [],
            "audioTracks": [],
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-active-sequence"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {"command": "get-active-sequence", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_get_full_sequence_info_omits_sequence_name_when_not_given(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-full-sequence-info"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-full-sequence-info", "args": {}}


def test_main_get_full_sequence_info_sends_sequence_name(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-full-sequence-info",
            "--sequence-name", "Sequence 02",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-full-sequence-info", "args": {"sequenceName": "Sequence 02"}}


def test_main_get_full_clip_info_sends_full_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "name": "clip.mp4",
            "trackIndex": 0,
            "clipIndex": 2,
            "components": [],
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-full-clip-info",
            "--sequence-name", "Sequence 01",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "2",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-full-clip-info",
        "args": {
            "sequenceName": "Sequence 01",
            "trackType": "video",
            "trackIndex": 0,
            "clipIndex": 2,
        },
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_get_full_clip_info_omits_sequence_name_when_not_given(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-full-clip-info",
            "--track-type", "audio",
            "--track-index", "1",
            "--clip-index", "0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert "sequenceName" not in body["args"]
    assert body["args"] == {"trackType": "audio", "trackIndex": 1, "clipIndex": 0}


def test_main_get_timeline_summary_omits_sequence_name_when_not_given(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-timeline-summary"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-timeline-summary", "args": {}}


def test_main_get_timeline_summary_sends_sequence_name(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-timeline-summary",
            "--sequence-name", "Sequence 03",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-timeline-summary", "args": {"sequenceName": "Sequence 03"}}


def test_parse_intervals_file_accepts_three_digit_minutes(tmp_path):
    cuts_file = tmp_path / "long.cuts.txt"
    cuts_file.write_text("100:05:03 - 100:06:10\n")

    intervals = premiere_cli._parse_intervals_file(str(cuts_file))

    assert intervals == [{"start": "100:05:03", "end": "100:06:10"}]


def test_main_get_project_info_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "name": "vlog0002",
            "path": "/Volumes/Extreme Pro/.../vlog0002.prproj",
            "numSequences": 1,
            "sequences": [{"name": "Sequence 01", "sequenceID": "guid-123", "frameRate": 25.0, "durationSeconds": 143.2}],
            "numRootItems": 4,
        },
    }
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-project-info"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {"command": "get-project-info", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_list_project_items_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "items": [
                {"name": "B-Roll", "treePath": "/B-Roll", "nodeId": "id-1", "type": "BIN", "isSequence": False, "mediaPath": None},
            ],
            "count": 1,
        },
    }
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "list-project-items"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {"command": "list-project-items", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_get_full_project_overview_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "project": {"name": "vlog0002", "path": "/tmp/vlog0002.prproj"},
            "binTree": {"name": "vlog0002", "bins": [], "items": []},
            "sequences": [],
            "mediaTypeCounts": {"video": 0, "audio": 0, "image": 0, "sequence": 0, "other": 0, "offline": 0},
        },
    }
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-full-project-overview"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {"command": "get-full-project-overview", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_search_project_items_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "items": [
                {"name": "vo-01.wav", "treePath": "/Audio/vo-01.wav", "nodeId": "id-2", "mediaPath": "/tmp/vo-01.wav", "isOffline": False, "colorLabel": 3},
            ],
            "count": 1,
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "search-project-items",
            "--name-contains", "vo-",
            "--extension", ".wav",
            "--offline-only",
            "--color-label", "3",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {
        "command": "search-project-items",
        "args": {
            "nameContains": "vo-",
            "extension": ".wav",
            "colorLabel": 3,
            "offlineOnly": True,
        },
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_search_project_items_omits_offline_only_when_not_given(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "search-project-items", "--name-contains", "vo-"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert "offlineOnly" not in body["args"]
    assert body["args"] == {"nameContains": "vo-"}


def test_main_search_project_items_exits_2_with_no_filters(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "search-project-items"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_premiere_state_sends_no_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "appVersion": "25.0",
            "project": None,
            "activeSequence": None,
            "playheadSeconds": None,
            "selection": None,
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-premiere-state"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {"command": "get-premiere-state", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_move_playhead_sends_timecode_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "sequenceName": "Sequence 01",
            "timecode": "00:12:05",
            "requestedSeconds": 12.2,
            "playheadSeconds": 12.2,
            "attempts": [{"form": "ticksString", "success": True}],
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "move-playhead",
            "--timecode", "00:12:05",
            "--sequence-name", "Sequence 01",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "move-playhead",
        "args": {"timecode": "00:12:05", "sequenceName": "Sequence 01"},
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_move_playhead_sends_seconds_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "sequenceName": "Sequence 01",
            "requestedSeconds": 12.5,
            "playheadSeconds": 12.5,
            "attempts": [{"form": "ticksString", "success": True}],
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "move-playhead",
            "--seconds", "12.5",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "move-playhead",
        "args": {"seconds": 12.5},
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_move_playhead_exits_2_when_both_given(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "move-playhead",
            "--timecode", "00:12:05",
            "--seconds", "12.5",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_move_playhead_exits_2_when_neither_given(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "move-playhead"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_inspect_dom_object_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "expression": "app.project.activeSequence",
            "typeofValue": "object",
            "stringValue": "[object Sequence]",
            "isNull": False,
            "isUndefined": False,
            "reflectMethods": ["getSettings"],
            "reflectProperties": ["name"],
            "forInKeys": ["name"],
            "commonProperties": {"name": "Sequence 01"},
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "inspect-dom-object",
            "--expression", "app.project.activeSequence",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {
        "command": "inspect-dom-object",
        "args": {"expression": "app.project.activeSequence"},
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_get_open_projects_sends_no_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "projects": [
                {"name": "vlog0002", "path": "/tmp/vlog0002.prproj", "isActive": True},
            ],
            "count": 1,
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-open-projects"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {"command": "get-open-projects", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_set_active_project_sends_name_and_path(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {
            "activated": {"name": "vlog0002", "path": "/tmp/vlog0002.prproj"},
            "attempts": [{"method": "activate", "success": True}],
        },
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-active-project",
            "--name", "vlog0002",
            "--path", "/tmp/vlog0002.prproj",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    path, body = _RecordingHandler.received[0]
    assert path == "/command"
    assert body == {
        "command": "set-active-project",
        "args": {"name": "vlog0002", "path": "/tmp/vlog0002.prproj"},
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_set_active_project_omits_unset_flag(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-active-project",
            "--name", "vlog0002",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-active-project", "args": {"name": "vlog0002"}}


def test_main_set_active_project_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "set-active-project"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_work_area_sends_sequence_name(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"sequenceName": "Sequence 01", "inSeconds": 1.0, "outSeconds": 5.0},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-work-area", "--sequence-name", "Sequence 01"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-work-area", "args": {"sequenceName": "Sequence 01"}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_get_work_area_omits_sequence_name_when_not_given(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-work-area"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-work-area", "args": {}}


def test_main_set_work_area_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"sequenceName": "Sequence 01", "startSeconds": 1.0, "endSeconds": 5.0},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-work-area",
            "--start-seconds", "1.0",
            "--end-seconds", "5.0",
            "--sequence-name", "Sequence 01",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-work-area",
        "args": {"startSeconds": 1.0, "endSeconds": 5.0, "sequenceName": "Sequence 01"},
    }
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_set_work_area_exits_2_without_bounds(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "set-work-area", "--start-seconds", "1.0"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_sequence_in_out_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"sequenceName": "Sequence 01", "inSeconds": 0.0, "outSeconds": 10.0},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-sequence-in-out"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-sequence-in-out", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_set_sequence_in_out_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"sequenceName": "Sequence 01", "inSeconds": 2.0, "outSeconds": 8.0},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-sequence-in-out",
            "--in-seconds", "2.0",
            "--out-seconds", "8.0",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-sequence-in-out", "args": {"inSeconds": 2.0, "outSeconds": 8.0}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_set_sequence_in_out_exits_2_without_bounds(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "set-sequence-in-out", "--in-seconds", "2.0"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_is_work_area_enabled_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"sequenceName": "Sequence 01", "workAreaEnabled": True},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "is-work-area-enabled"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "is-work-area-enabled", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_get_export_file_extension_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"sequenceName": "Sequence 01", "presetPath": "/tmp/h264.epr", "extension": "mp4"},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-export-file-extension",
            "--preset-path", "/tmp/h264.epr",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-export-file-extension", "args": {"presetPath": "/tmp/h264.epr"}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_get_workspaces_sends_no_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"workspaces": ["Editing", "Color"], "count": 2}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-workspaces"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-workspaces", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_set_workspace_sends_correct_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"set": True, "workspace": "Color"}}
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-workspace", "--name", "Color"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-workspace", "args": {"name": "Color"}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_play_timeline_sends_no_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"playing": True}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "play-timeline"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "play-timeline", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_stop_playback_sends_no_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"stopped": True}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "stop-playback"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "stop-playback", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_play_source_monitor_sends_speed(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"playing": True, "speed": 2.0}}
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "play-source-monitor", "--speed", "2.0"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "play-source-monitor", "args": {"speed": 2.0}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_play_source_monitor_omits_speed_when_not_given(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "play-source-monitor"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "play-source-monitor", "args": {}}


def test_main_get_source_monitor_position_sends_no_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"seconds": 3.5}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-source-monitor-position"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-source-monitor-position", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True


def test_main_get_version_info_sends_no_args(monkeypatch, capsys, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"version": "25.0.0", "buildNumber": "123", "isDocumentOpen": True, "path": "/Applications/..."},
    }
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-version-info"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-version-info", "args": {}}
    printed = json.loads(capsys.readouterr().out)
    assert printed["ok"] is True




def test_main_get_bin_contents_sends_bin_path(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-bin-contents", "--bin-path", "B-Roll/Interviews"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-bin-contents", "args": {"binPath": "B-Roll/Interviews"}}


def test_main_get_project_item_info_sends_node_id(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-project-item-info", "--node-id", "id-1"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-project-item-info", "args": {"nodeId": "id-1"}}


def test_main_get_project_item_info_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "get-project-item-info"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_timeline_gaps_sends_all_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-timeline-gaps",
            "--sequence-name", "Sequence 01",
            "--track-type", "video",
            "--min-gap-seconds", "0.1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-timeline-gaps",
        "args": {"sequenceName": "Sequence 01", "trackType": "video", "minGapSeconds": 0.1},
    }


def test_main_get_offline_media_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-offline-media"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-offline-media", "args": {}}


def test_main_get_used_media_report_sends_sequence_name(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-used-media-report", "--sequence-name", "Sequence 01"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-used-media-report", "args": {"sequenceName": "Sequence 01"}}


def test_main_get_all_project_paths_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-all-project-paths"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-all-project-paths", "args": {}}


def test_main_get_unused_media_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-unused-media"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-unused-media", "args": {}}


def test_main_get_duplicate_media_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-duplicate-media"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-duplicate-media", "args": {}}


def test_main_get_clip_links_sends_full_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-clip-links",
            "--sequence-name", "Sequence 01",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-clip-links",
        "args": {"sequenceName": "Sequence 01", "trackType": "video", "trackIndex": 0, "clipIndex": 2},
    }


def test_main_get_insertion_bin_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-insertion-bin"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-insertion-bin", "args": {}}


def test_main_get_project_panel_metadata_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-project-panel-metadata"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-project-panel-metadata", "args": {}}


def test_main_list_available_effects_sends_no_args(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"effects": [{"name": "Gaussian Blur", "index": 0}], "count": 1}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "list-available-effects"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "list-available-effects", "args": {}}


def test_main_list_available_audio_effects_sends_no_args(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"effects": [], "count": 0}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "list-available-audio-effects"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "list-available-audio-effects", "args": {}}


def test_main_list_available_transitions_sends_no_args(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"transitions": [], "count": 0, "listError": None, "probedByName": True}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "list-available-transitions"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "list-available-transitions", "args": {}}


def test_main_list_available_audio_transitions_sends_no_args(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"transitions": [], "count": 0}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "list-available-audio-transitions"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "list-available-audio-transitions", "args": {}}


def test_main_list_markers_sends_sequence_name(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"sequenceName": "Sequence 01", "markers": [], "markerCount": 0}}
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "list-markers", "--sequence-name", "Sequence 01"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "list-markers", "args": {"sequenceName": "Sequence 01"}}


def test_main_get_clip_markers_sends_full_args(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"sequenceName": "Sequence 01", "trackType": "video", "trackIndex": 0, "clipIndex": 1, "markers": [], "markerCount": 0},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "get-clip-markers",
            "--sequence-name", "Sequence 01",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-clip-markers",
        "args": {"sequenceName": "Sequence 01", "trackType": "video", "trackIndex": 0, "clipIndex": 1},
    }


def test_main_get_sequence_markers_by_type_sends_type(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"sequenceName": "Sequence 01", "type": "Chapter", "markers": [], "count": 0}}
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-sequence-markers-by-type", "--type", "Chapter"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-sequence-markers-by-type", "args": {"type": "Chapter"}}


def test_main_get_item_metadata_sends_node_id(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"name": "clip.mp4", "nodeId": "id-1", "mediaPath": None, "projectMetadata": None}}
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-item-metadata", "--node-id", "id-1"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-item-metadata", "args": {"nodeId": "id-1"}}


def test_main_get_item_metadata_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "get-item-metadata"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_color_label_sends_name(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"name": "clip.mp4", "nodeId": "id-1", "colorLabel": 3}}
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-color-label", "--name", "clip.mp4"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-color-label", "args": {"name": "clip.mp4"}}


def test_main_get_color_label_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "get-color-label"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_footage_interpretation_sends_node_id(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"name": "clip.mp4", "nodeId": "id-1", "alphaUsage": None, "fieldType": None, "frameRate": 25.0, "ignoreAlpha": None, "invertAlpha": None, "pixelAspectRatio": 1.0},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-footage-interpretation", "--node-id", "id-1"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-footage-interpretation", "args": {"nodeId": "id-1"}}


def test_main_get_footage_interpretation_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "get-footage-interpretation"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_xmp_metadata_sends_node_id(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"name": "clip.mp4", "nodeId": "id-1", "xmpMetadata": "<x:xmpmeta/>", "truncated": False}}
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-xmp-metadata", "--node-id", "id-1"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-xmp-metadata", "args": {"nodeId": "id-1"}}


def test_main_get_xmp_metadata_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "get-xmp-metadata"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_color_space_sends_node_id(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {
        "ok": True,
        "result": {"name": "clip.mp4", "nodeId": "id-1", "colorSpace": "rec709", "originalColorSpace": None, "embeddedLUT": None, "inputLUT": None},
    }
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-color-space", "--node-id", "id-1"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-color-space", "args": {"nodeId": "id-1"}}


def test_main_get_color_space_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "get-color-space"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_render_queue_status_sends_no_args(monkeypatch, fake_panel):
    _RecordingHandler.response_body = {"ok": True, "result": {"isRunning": False, "info": "check AME"}}
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-render-queue-status"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 0
    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-render-queue-status", "args": {}}


def test_main_get_clip_at_position_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-clip-at-position",
            "--seconds", "12.5",
            "--track-type", "video",
            "--track-index", "0",
            "--sequence-name", "Sequence 01",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-clip-at-position",
        "args": {"seconds": 12.5, "trackType": "video", "trackIndex": 0, "sequenceName": "Sequence 01"},
    }


def test_main_get_clip_at_position_exits_2_when_track_index_without_track_type(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "get-clip-at-position", "--seconds", "12.5", "--track-index", "0"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_get_clip_at_playhead_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-clip-at-playhead", "--track-type", "audio"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-clip-at-playhead", "args": {"trackType": "audio"}}


def test_main_get_next_edit_point_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-next-edit-point",
            "--direction", "previous",
            "--track-type", "video",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-next-edit-point", "args": {"direction": "previous", "trackType": "video"}}


def test_main_get_sequence_count_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-sequence-count"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-sequence-count", "args": {}}


def test_main_get_total_clip_count_sends_sequence_name(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-total-clip-count", "--sequence-name", "Sequence 01"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-total-clip-count", "args": {"sequenceName": "Sequence 01"}}


def test_main_get_target_tracks_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-target-tracks"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-target-tracks", "args": {}}


def test_main_get_track_info_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-track-info",
            "--track-type", "audio",
            "--track-index", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-track-info", "args": {"trackType": "audio", "trackIndex": 1}}


def test_main_get_encoder_presets_sends_format_filter(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "get-encoder-presets", "--format", "H.264"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-encoder-presets", "args": {"format": "H.264"}}


def test_main_get_qe_clip_info_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-qe-clip-info",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-qe-clip-info",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 2},
    }


def test_main_get_source_monitor_info_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-source-monitor-info"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-source-monitor-info", "args": {}}


def test_main_get_clip_adjustment_layer_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-clip-adjustment-layer",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-clip-adjustment-layer",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1},
    }


def test_main_add_marker_sends_full_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "add-marker",
            "--seconds", "5.0",
            "--name", "Chapter 1",
            "--comments", "hi",
            "--type", "Chapter",
            "--duration-seconds", "2.0",
            "--color-index", "3",
            "--sequence-name", "Sequence 01",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-marker",
        "args": {
            "seconds": 5.0,
            "name": "Chapter 1",
            "comments": "hi",
            "type": "Chapter",
            "durationSeconds": 2.0,
            "colorIndex": 3,
            "sequenceName": "Sequence 01",
        },
    }


def test_main_update_marker_sends_guid_and_fields(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "update-marker",
            "--guid", "guid-1",
            "--name", "Renamed",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "update-marker", "args": {"guid": "guid-1", "name": "Renamed"}}


def test_main_delete_marker_sends_guid(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys, "argv", ["premiere-cli", "--port", str(fake_panel), "delete-marker", "--guid", "guid-1"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "delete-marker", "args": {"guid": "guid-1"}}


def test_main_add_marker_to_project_item_sends_full_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "add-marker-to-project-item",
            "--node-id", "id-1",
            "--seconds", "3.0",
            "--marker-name", "Note",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-marker-to-project-item",
        "args": {"nodeId": "id-1", "seconds": 3.0, "markerName": "Note"},
    }


def test_main_add_marker_to_project_item_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(
        sys, "argv", ["premiere-cli", "add-marker-to-project-item", "--seconds", "3.0"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_redo_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "redo"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "redo", "args": {}}


def test_main_undo_sends_count(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "undo", "--count", "3"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "undo", "args": {"count": 3}}


def test_main_undo_defaults_to_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "undo"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "undo", "args": {}}


def test_main_move_playhead_to_edit_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "move-playhead-to-edit", "--direction", "previous", "--sequence-name", "Sequence 01",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "move-playhead-to-edit",
        "args": {"direction": "previous", "sequenceName": "Sequence 01"},
    }


def test_main_set_poster_frame_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-poster-frame", "--name", "clip.mp4", "--seconds", "1.5"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-poster-frame", "args": {"name": "clip.mp4", "seconds": 1.5}}


def test_main_set_poster_frame_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "set-poster-frame", "--seconds", "1.5"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_select_project_item_sends_node_id(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys, "argv", ["premiere-cli", "--port", str(fake_panel), "select-project-item", "--node-id", "id-1"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "select-project-item", "args": {"nodeId": "id-1"}}


def test_main_select_project_item_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "select-project-item"])

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_select_clips_by_name_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "select-clips-by-name",
            "--name-contains", "b-roll",
            "--add-to-selection",
            "--sequence-name", "Sequence 01",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "select-clips-by-name",
        "args": {"nameContains": "b-roll", "addToSelection": True, "sequenceName": "Sequence 01"},
    }


def test_main_select_all_clips_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "select-all-clips", "--track-type", "video"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "select-all-clips", "args": {"trackType": "video"}}


def test_main_deselect_all_clips_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "deselect-all-clips"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "deselect-all-clips", "args": {}}


def test_main_select_clips_in_range_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "select-clips-in-range",
            "--start-seconds", "1.0",
            "--end-seconds", "5.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "select-clips-in-range", "args": {"startSeconds": 1.0, "endSeconds": 5.0}}


def test_main_select_clips_by_color_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "select-clips-by-color", "--color-label", "3"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "select-clips-by-color", "args": {"colorLabel": 3}}


def test_main_invert_selection_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "invert-selection"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "invert-selection", "args": {}}


def test_main_select_disabled_clips_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "select-disabled-clips"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "select-disabled-clips", "args": {}}


def test_main_set_clip_selection_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-clip-selection",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "2",
            "--select",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-selection",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 2, "selected": True},
    }


def test_main_set_clip_selection_deselect_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-clip-selection",
            "--track-type", "audio",
            "--track-index", "1",
            "--clip-index", "0",
            "--deselect",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-selection",
        "args": {"trackType": "audio", "trackIndex": 1, "clipIndex": 0, "selected": False},
    }


def test_main_add_track_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "add-track",
            "--track-type", "audio",
            "--index", "2",
            "--count", "3",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-track",
        "args": {"trackType": "audio", "index": 2, "count": 3},
    }


def test_main_lock_track_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "lock-track",
            "--track-type", "video",
            "--track-index", "0",
            "--locked", "true",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "lock-track",
        "args": {"trackType": "video", "trackIndex": 0, "locked": True},
    }


def test_main_set_track_visibility_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-track-visibility",
            "--track-index", "1",
            "--visible", "false",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-track-visibility",
        "args": {"trackType": "video", "trackIndex": 1, "visible": False},
    }


def test_main_set_track_mute_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-track-mute",
            "--track-type", "audio",
            "--track-index", "0",
            "--muted", "true",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-track-mute",
        "args": {"trackType": "audio", "trackIndex": 0, "muted": True},
    }


def test_main_rename_track_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "rename-track",
            "--track-type", "video",
            "--track-index", "0",
            "--name", "Narration",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "rename-track",
        "args": {"trackType": "video", "trackIndex": 0, "name": "Narration"},
    }


def test_main_set_target_track_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-target-track",
            "--track-type", "audio",
            "--track-index", "1",
            "--targeted", "true",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-target-track",
        "args": {"trackType": "audio", "trackIndex": 1, "targeted": True},
    }


def test_main_set_all_tracks_targeted_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-all-tracks-targeted",
            "--targeted", "false",
            "--track-type", "audio",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-all-tracks-targeted",
        "args": {"targeted": False, "trackType": "audio"},
    }


def test_main_delete_marker_project_item_addressing(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "delete-marker",
            "--guid", "abc-123",
            "--node-id", "000f4254",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body["args"] == {"guid": "abc-123", "nodeId": "000f4254"}


def test_main_set_clip_position_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-clip-position",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--x", "100", "--y", "-50",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-position",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "x": 100.0, "y": -50.0},
    }


def test_main_set_clip_scale_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-clip-scale",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--scale", "150",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-scale",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "scale": 150.0},
    }


def test_main_set_clip_rotation_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-clip-rotation",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--degrees", "45",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-rotation",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "degrees": 45.0},
    }


def test_main_set_clip_anchor_point_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-clip-anchor-point",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--x", "10", "--y", "20",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-anchor-point",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "x": 10.0, "y": 20.0},
    }


def test_main_set_clip_opacity_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-clip-opacity",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--opacity", "75",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-opacity",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "opacity": 75.0},
    }


def test_main_set_uniform_scale_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-uniform-scale",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--uniform", "false",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-uniform-scale",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "uniform": False},
    }


def test_main_set_scale_width_height_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-scale-width-height",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--scale-width", "80", "--scale-height", "120",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-scale-width-height",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "scaleWidth": 80.0, "scaleHeight": 120.0},
    }


def test_main_set_scale_width_height_exits_2_with_neither_flag(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "set-scale-width-height",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()
    assert exc_info.value.code == 2


def test_main_set_anti_alias_quality_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-anti-alias-quality",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--amount", "0.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-anti-alias-quality",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "amount": 0.5},
    }


def test_main_set_blend_mode_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-blend-mode",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--blend-mode", "4",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-blend-mode",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "blendMode": 4},
    }


def test_main_set_clip_volume_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-clip-volume",
            "--track-type", "audio",
            "--track-index", "0",
            "--clip-index", "1",
            "--db", "-6.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-volume",
        "args": {"trackType": "audio", "trackIndex": 0, "clipIndex": 1, "db": -6.0},
    }


def test_main_set_clip_pan_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-clip-pan",
            "--track-type", "audio",
            "--track-index", "0",
            "--clip-index", "0",
            "--pan", "-50",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-pan",
        "args": {"trackType": "audio", "trackIndex": 0, "clipIndex": 0, "pan": -50.0},
    }


def test_main_adjust_audio_levels_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "adjust-audio-levels",
            "--track-type", "audio",
            "--track-index", "1",
            "--clip-index", "2",
            "--db", "3.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "adjust-audio-levels",
        "args": {"trackType": "audio", "trackIndex": 1, "clipIndex": 2, "db": 3.5},
    }


def test_main_add_audio_keyframes_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "add-audio-keyframes",
            "--track-type", "audio",
            "--track-index", "0",
            "--clip-index", "0",
            "--keyframes", '[{"seconds": 0.0, "db": -60.0}, {"seconds": 1.0, "db": 0.0}]',
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-audio-keyframes",
        "args": {
            "trackType": "audio",
            "trackIndex": 0,
            "clipIndex": 0,
            "keyframes": '[{"seconds": 0.0, "db": -60.0}, {"seconds": 1.0, "db": 0.0}]',
        },
    }


def test_main_add_audio_keyframes_rejects_invalid_json(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "add-audio-keyframes",
            "--track-type", "audio",
            "--track-index", "0",
            "--clip-index", "0",
            "--keyframes", "not json",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()
    assert exc_info.value.code == 2


def test_main_rename_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "rename-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "3",
            "--name", "Intro Take 2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "rename-clip",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 3, "name": "Intro Take 2"},
    }


def test_main_batch_rename_clips_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "batch-rename-clips",
            "--track-type", "video",
            "--track-index", "1",
            "--new-name-template", "Scene_{n}",
            "--name-contains", "raw",
            "--start-number", "5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "batch-rename-clips",
        "args": {
            "trackType": "video",
            "trackIndex": 1,
            "newNameTemplate": "Scene_{n}",
            "nameContains": "raw",
            "startNumber": 5,
        },
    }


def test_main_set_clip_enabled_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-clip-enabled",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "2",
            "--enabled", "false",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-enabled",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 2, "enabled": False},
    }


def test_main_batch_set_clips_enabled_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "batch-set-clips-enabled",
            "--enabled", "true",
            "--name-contains", "b-roll",
            "--track-type", "video",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "batch-set-clips-enabled",
        "args": {"enabled": True, "nameContains": "b-roll", "trackType": "video"},
    }


def test_main_set_frame_blend_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-frame-blend",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "0",
            "--enabled", "true",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-frame-blend",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 0, "enabled": True},
    }


def test_main_set_time_interpolation_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-time-interpolation",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "0",
            "--type", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-time-interpolation",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 0, "type": 2},
    }


def test_main_set_clip_properties_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-clip-properties",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "0",
            "--opacity", "80",
            "--rotation", "15",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-properties",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 0, "opacity": 80.0, "rotation": 15.0},
    }


def test_main_set_clip_properties_exits_2_with_no_properties(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-clip-properties",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "0",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()
    assert exc_info.value.code == 2


def test_main_set_item_metadata_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-item-metadata",
            "--node-id", "000f4254",
            "--field-path", "Column.Intrinsic.Description",
            "--value", "b-roll of the harbor",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-item-metadata",
        "args": {
            "nodeId": "000f4254",
            "fieldPath": "Column.Intrinsic.Description",
            "value": "b-roll of the harbor",
        },
    }


def test_main_set_item_metadata_exits_2_without_addressing(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "set-item-metadata", "--field-path", "x", "--value", "y"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_set_color_label_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-color-label",
            "--name", "clip01.mp4",
            "--color-label", "3",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-color-label",
        "args": {"name": "clip01.mp4", "colorLabel": 3},
    }


def test_main_set_color_label_exits_2_on_out_of_range(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-color-label",
            "--name", "clip01.mp4",
            "--color-label", "16",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_set_footage_interpretation_sends_given_fields(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-footage-interpretation",
            "--node-id", "000f4254",
            "--frame-rate", "29.97",
            "--pixel-aspect-ratio", "1.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-footage-interpretation",
        "args": {"nodeId": "000f4254", "frameRate": 29.97, "pixelAspectRatio": 1.0},
    }


def test_main_set_footage_interpretation_exits_2_with_no_fields(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "set-footage-interpretation", "--node-id", "000f4254"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_set_xmp_metadata_sends_inline_xmp(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-xmp-metadata",
            "--node-id", "000f4254",
            "--xmp", "<x:xmpmeta>...</x:xmpmeta>",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-xmp-metadata",
        "args": {"nodeId": "000f4254", "xmp": "<x:xmpmeta>...</x:xmpmeta>"},
    }


def test_main_set_xmp_metadata_reads_xmp_file(monkeypatch, fake_panel, tmp_path):
    xmp_file = tmp_path / "metadata.xmp"
    xmp_file.write_text("<x:xmpmeta>from file</x:xmpmeta>", encoding="utf-8")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-xmp-metadata",
            "--node-id", "000f4254",
            "--xmp-file", str(xmp_file),
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-xmp-metadata",
        "args": {"nodeId": "000f4254", "xmp": "<x:xmpmeta>from file</x:xmpmeta>"},
    }


def test_main_set_xmp_metadata_exits_2_without_xmp_or_file(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "set-xmp-metadata", "--node-id", "000f4254"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_apply_effect_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "apply-effect",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--effect-name", "Gaussian Blur",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "apply-effect",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "effectName": "Gaussian Blur"},
    }


def test_main_apply_audio_effect_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "apply-audio-effect",
            "--track-type", "audio",
            "--track-index", "0",
            "--clip-index", "0",
            "--effect-name", "Parametric Equalizer",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "apply-audio-effect",
        "args": {"trackType": "audio", "trackIndex": 0, "clipIndex": 0, "effectName": "Parametric Equalizer"},
    }


def test_main_remove_effect_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "remove-effect",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--component-index", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "remove-effect",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "componentIndex": 2},
    }


def test_main_remove_effect_by_name_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "remove-effect-by-name",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--effect-name", "Gaussian Blur",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "remove-effect-by-name",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "effectName": "Gaussian Blur"},
    }


def test_main_remove_all_effects_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "remove-all-effects",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "remove-all-effects",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1},
    }


def test_main_color_correct_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "color-correct",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--exposure", "0.5",
            "--saturation", "0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "color-correct",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "exposure": 0.5, "saturation": 0.0},
    }


def test_main_color_correct_exits_2_with_no_fields(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "color-correct", "--track-type", "video", "--track-index", "0", "--clip-index", "1"],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_apply_lut_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "apply-lut",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--lut-path", "/tmp/look.cube",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "apply-lut",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "lutPath": "/tmp/look.cube"},
    }


def test_main_stabilize_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "stabilize-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--smoothness", "50",
            "--method", "Subspace Warp",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "stabilize-clip",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "smoothness": 50.0, "method": "Subspace Warp",
        },
    }


def test_main_copy_effects_between_clips_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "copy-effects-between-clips",
            "--source-track-type", "video",
            "--source-track-index", "0",
            "--source-clip-index", "0",
            "--target-track-type", "video",
            "--target-track-index", "0",
            "--target-clip-index", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "copy-effects-between-clips",
        "args": {
            "sourceTrackType": "video", "sourceTrackIndex": 0, "sourceClipIndex": 0,
            "targetTrackType": "video", "targetTrackIndex": 0, "targetClipIndex": 1,
        },
    }


def test_main_copy_effect_values_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "copy-effect-values",
            "--source-track-type", "video",
            "--source-track-index", "0",
            "--source-clip-index", "0",
            "--target-track-type", "video",
            "--target-track-index", "0",
            "--target-clip-index", "1",
            "--effect-name", "Lumetri Color",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "copy-effect-values",
        "args": {
            "sourceTrackType": "video", "sourceTrackIndex": 0, "sourceClipIndex": 0,
            "targetTrackType": "video", "targetTrackIndex": 0, "targetClipIndex": 1,
            "effectName": "Lumetri Color",
        },
    }


def test_main_batch_apply_effect_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "batch-apply-effect",
            "--effect-name", "Gaussian Blur",
            "--name-contains", "interview",
            "--track-type", "video",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "batch-apply-effect",
        "args": {"trackType": "video", "effectName": "Gaussian Blur", "nameContains": "interview"},
    }


def test_main_get_effect_properties_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "get-effect-properties",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-effect-properties",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "componentName": "Motion"},
    }


def test_main_set_effect_property_coerces_number(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-effect-property",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion", "--property-name", "Scale",
            "--value", "150", "--value-type", "number",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-effect-property",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "componentName": "Motion", "propertyName": "Scale",
            "value": 150.0, "valueType": "number",
        },
    }


def test_main_set_effect_property_coerces_boolean(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-effect-property",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion", "--property-name", "Uniform Scale",
            "--value", "true", "--value-type", "boolean",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body["args"]["value"] is True


def test_main_get_keyframes_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "get-keyframes",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion", "--property-name", "Position",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-keyframes",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "componentName": "Motion", "propertyName": "Position",
        },
    }


def test_main_add_keyframe_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "add-keyframe",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion", "--property-name", "Scale",
            "--seconds", "1.5", "--value", "120",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-keyframe",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "componentName": "Motion", "propertyName": "Scale",
            "seconds": 1.5, "value": 120.0,
        },
    }


def test_main_remove_keyframe_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "remove-keyframe",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion", "--property-name", "Scale",
            "--seconds", "1.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "remove-keyframe",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "componentName": "Motion", "propertyName": "Scale",
            "seconds": 1.5,
        },
    }


def test_main_remove_keyframe_range_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "remove-keyframe-range",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion", "--property-name", "Scale",
            "--start-seconds", "0", "--end-seconds", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "remove-keyframe-range",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "componentName": "Motion", "propertyName": "Scale",
            "startSeconds": 0.0, "endSeconds": 2.0,
        },
    }


def test_main_set_keyframe_interpolation_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-keyframe-interpolation",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion", "--property-name", "Scale",
            "--seconds", "1.5", "--interpolation-type", "5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-keyframe-interpolation",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "componentName": "Motion", "propertyName": "Scale",
            "seconds": 1.5, "interpolationType": 5,
        },
    }


def test_main_get_value_at_time_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "get-value-at-time",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Motion", "--property-name", "Scale",
            "--seconds", "1.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-value-at-time",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "componentName": "Motion", "propertyName": "Scale",
            "seconds": 1.5,
        },
    }


def test_main_set_color_value_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "set-color-value",
            "--track-type", "video", "--track-index", "0", "--clip-index", "1",
            "--component-name", "Lumetri Color", "--property-name", "Tint",
            "--alpha", "255", "--red", "128", "--green", "64", "--blue", "32",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-color-value",
        "args": {
            "trackType": "video", "trackIndex": 0, "clipIndex": 1,
            "componentName": "Lumetri Color", "propertyName": "Tint",
            "alpha": 255.0, "red": 128.0, "green": 64.0, "blue": 32.0,
        },
    }


def test_main_add_transition_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "add-transition",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--at-end", "true",
            "--transition-name", "Cross Dissolve",
            "--duration-seconds", "0.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-transition",
        "args": {
            "trackType": "video",
            "trackIndex": 0,
            "clipIndex": 1,
            "atEnd": True,
            "transitionName": "Cross Dissolve",
            "durationSeconds": 0.5,
        },
    }


def test_main_batch_add_transitions_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "batch-add-transitions",
            "--track-index", "1",
            "--transition-name", "Cross Dissolve",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "batch-add-transitions",
        "args": {"trackIndex": 1, "transitionName": "Cross Dissolve"},
    }


def test_main_remove_transition_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "remove-transition",
            "--track-type", "video",
            "--track-index", "0",
            "--transition-index", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "remove-transition",
        "args": {"trackType": "video", "trackIndex": 0, "transitionIndex": 2},
    }


def test_main_add_to_timeline_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "add-to-timeline",
            "--node-id", "abc123",
            "--track-type", "video",
            "--track-index", "0",
            "--start-seconds", "5.0",
            "--mode", "insert",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-to-timeline",
        "args": {
            "nodeId": "abc123",
            "trackType": "video",
            "trackIndex": 0,
            "startSeconds": 5.0,
            "mode": "insert",
        },
    }


def test_main_remove_from_timeline_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "remove-from-timeline",
            "--track-type", "audio",
            "--track-index", "1",
            "--clip-index", "2",
            "--ripple", "true",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "remove-from-timeline",
        "args": {"trackType": "audio", "trackIndex": 1, "clipIndex": 2, "ripple": True},
    }


def test_main_move_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "move-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--start-seconds", "12.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "move-clip",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "startSeconds": 12.5},
    }


def test_main_trim_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "trim-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--in-point-seconds", "1.0",
            "--out-point-seconds", "3.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "trim-clip",
        "args": {
            "trackType": "video",
            "trackIndex": 0,
            "clipIndex": 1,
            "inPointSeconds": 1.0,
            "outPointSeconds": 3.0,
        },
    }


def test_main_split_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "split-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--seconds", "10.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "split-clip",
        "args": {"trackType": "video", "trackIndex": 0, "seconds": 10.0},
    }


def test_main_duplicate_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "duplicate-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--target-start-seconds", "20.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "duplicate-clip",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "targetStartSeconds": 20.0},
    }


def test_main_replace_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "replace-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--replacement-node-id", "xyz789",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "replace-clip",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "replacementNodeId": "xyz789"},
    }


def test_main_set_clip_speed_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-clip-speed",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--speed-percent", "200",
            "--ripple", "true",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-clip-speed",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "speedPercent": 200.0, "ripple": True},
    }


def test_main_get_clip_speed_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-clip-speed",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-clip-speed",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1},
    }


def test_main_ripple_delete_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "ripple-delete-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "ripple-delete-clip",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 2},
    }


def test_main_roll_edit_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "roll-edit",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--offset-seconds", "0.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "roll-edit",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "offsetSeconds": 0.5},
    }


def test_main_slide_edit_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "slide-edit",
            "--track-type", "audio",
            "--track-index", "1",
            "--clip-index", "0",
            "--offset-seconds", "-1.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "slide-edit",
        "args": {"trackType": "audio", "trackIndex": 1, "clipIndex": 0, "offsetSeconds": -1.5},
    }


def test_main_slip_edit_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "slip-edit",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "3",
            "--offset-seconds", "0.25",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "slip-edit",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 3, "offsetSeconds": 0.25},
    }


def test_main_move_clip_to_track_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "move-clip-to-track",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
            "--target-track-index", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "move-clip-to-track",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1, "targetTrackIndex": 2},
    }


def test_main_reverse_clip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "reverse-clip",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "0",
            "--reverse", "false",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "reverse-clip",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 0, "reverse": False},
    }


def test_main_link_selection_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "link-selection",
            "--sequence-name", "Main",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "link-selection",
        "args": {"sequenceName": "Main"},
    }


def test_main_unlink_selection_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "unlink-selection",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "unlink-selection",
        "args": {},
    }


def test_main_overwrite_clip_at_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "overwrite-clip-at",
            "--item-name", "b-roll.mp4",
            "--track-type", "video",
            "--track-index", "0",
            "--start-seconds", "12.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "overwrite-clip-at",
        "args": {
            "itemName": "b-roll.mp4",
            "trackType": "video",
            "trackIndex": 0,
            "startSeconds": 12.5,
        },
    }


def test_main_razor_all_tracks_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "razor-all-tracks", "--seconds", "12.5"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "razor-all-tracks", "args": {"seconds": 12.5}}


def test_main_set_item_in_out_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-item-in-out",
            "--node-id", "abc123",
            "--in-seconds", "1.0",
            "--out-seconds", "5.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-item-in-out",
        "args": {"nodeId": "abc123", "inSeconds": 1.0, "outSeconds": 5.0},
    }


def test_main_set_item_in_out_requires_id(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "set-item-in-out", "--in-seconds", "1.0"],
    )
    with pytest.raises(SystemExit) as exc:
        premiere_cli.main()
    assert exc.value.code == 2


def test_main_clear_item_in_out_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "clear-item-in-out",
            "--name", "MyClip.mov",
            "--clear-in", "true",
            "--clear-out", "false",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "clear-item-in-out",
        "args": {"name": "MyClip.mov", "clearIn": True, "clearOut": False},
    }


def test_main_clear_sequence_in_out_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "clear-sequence-in-out", "--sequence-name", "Seq 1"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "clear-sequence-in-out", "args": {"sequenceName": "Seq 1"}}


def test_main_remove_selected_clips_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "remove-selected-clips", "--ripple", "true"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "remove-selected-clips", "args": {"ripple": True}}


def test_main_lift_selection_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "lift-selection"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "lift-selection", "args": {}}


def test_main_extract_selection_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "extract-selection"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "extract-selection", "args": {}}


def test_main_nest_clips_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "nest-clips", "--name", "My Nest"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "nest-clips", "args": {"name": "My Nest"}}


def test_main_freeze_frame_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "freeze-frame",
            "--track-index", "0",
            "--clip-index", "1",
            "--output-path", "/tmp/freeze.png",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "freeze-frame",
        "args": {"trackIndex": 0, "clipIndex": 1, "outputPath": "/tmp/freeze.png"},
    }


def test_main_match_frame_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "match-frame", "--track-index", "1", "--seconds", "3.0"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "match-frame", "args": {"trackIndex": 1, "seconds": 3.0}}


def test_main_add_adjustment_layer_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "add-adjustment-layer", "--track-index", "2", "--start-seconds", "4.0"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "add-adjustment-layer", "args": {"trackIndex": 2, "startSeconds": 4.0}}


def test_main_unnest_sequence_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "unnest-sequence", "--node-id", "xyz789"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "unnest-sequence", "args": {"nodeId": "xyz789"}}


def test_main_import_media_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "import-media", "--file-path", "/tmp/clip.mp4", "--target-bin-path", "B-Roll"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "import-media",
        "args": {"filePath": "/tmp/clip.mp4", "targetBinPath": "B-Roll"},
    }


def test_main_import_folder_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "import-folder", "--folder-path", "/tmp/footage"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "import-folder", "args": {"folderPath": "/tmp/footage"}}


def test_main_import_image_sequence_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "import-image-sequence", "--first-frame-path", "/tmp/seq/frame_001.png"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "import-image-sequence", "args": {"firstFramePath": "/tmp/seq/frame_001.png"}}


def test_main_create_bin_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "create-bin", "--bin-path", "B-Roll/Interviews"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "create-bin", "args": {"binPath": "B-Roll/Interviews"}}


def test_main_rename_bin_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "rename-bin", "--bin-path", "B-Roll", "--new-name", "Archive"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "rename-bin", "args": {"binPath": "B-Roll", "newName": "Archive"}}


def test_main_move_items_to_bin_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "move-items-to-bin", "--node-ids", '["id1", "id2"]', "--target-bin-path", "Archive"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "move-items-to-bin",
        "args": {"nodeIds": '["id1", "id2"]', "targetBinPath": "Archive"},
    }


def test_main_relink_media_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "relink-media", "--node-id", "abc123", "--new-path", "/tmp/new.mov"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "relink-media", "args": {"nodeId": "abc123", "newPath": "/tmp/new.mov"}}


def test_main_refresh_media_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "refresh-media", "--name", "clip.mov"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "refresh-media", "args": {"name": "clip.mov"}}


def test_main_set_item_offline_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-item-offline", "--node-id", "abc123"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-item-offline", "args": {"nodeId": "abc123"}}


def test_main_detach_proxy_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "detach-proxy", "--node-id", "abc123"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "detach-proxy", "args": {"nodeId": "abc123"}}


def test_main_set_override_frame_rate_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-override-frame-rate", "--node-id", "abc123", "--fps", "24"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-override-frame-rate", "args": {"nodeId": "abc123", "fps": 24.0}}


def test_main_set_override_pixel_aspect_ratio_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "set-override-pixel-aspect-ratio",
            "--node-id", "abc123", "--numerator", "1", "--denominator", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-override-pixel-aspect-ratio",
        "args": {"nodeId": "abc123", "numerator": 1.0, "denominator": 1.0},
    }


def test_main_set_scale_to_frame_size_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-scale-to-frame-size", "--node-id", "abc123"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-scale-to-frame-size", "args": {"nodeId": "abc123"}}


def test_main_set_item_start_time_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-item-start-time", "--node-id", "abc123", "--seconds", "5.0"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-item-start-time", "args": {"nodeId": "abc123", "seconds": 5.0}}


def test_main_rename_project_item_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "rename-project-item", "--node-id", "abc123", "--new-name", "Renamed Clip"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "rename-project-item", "args": {"nodeId": "abc123", "newName": "Renamed Clip"}}


def test_main_save_project_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "save-project"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "save-project", "args": {}}


def test_main_save_project_as_sends_path(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "save-project-as", "--path", "/tmp/new.prproj"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "save-project-as", "args": {"path": "/tmp/new.prproj"}}


def test_main_open_project_sends_path(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "open-project", "--path", "/tmp/existing.prproj"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "open-project", "args": {"path": "/tmp/existing.prproj"}}


def test_main_set_active_sequence_sends_sequence_name(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-active-sequence", "--sequence-name", "Sequence 02"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-active-sequence", "args": {"sequenceName": "Sequence 02"}}


def test_main_find_items_by_media_path_sends_path_contains(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "find-items-by-media-path", "--path-contains", "vlog0002"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "find-items-by-media-path", "args": {"pathContains": "vlog0002"}}


def test_main_create_smart_bin_sends_name_and_query(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "create-smart-bin", "--name", "Offline", "--query", "isOffline:true"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "create-smart-bin", "args": {"name": "Offline", "query": "isOffline:true"}}


def test_main_add_custom_metadata_field_sends_name_label_type(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "add-custom-metadata-field",
            "--name", "Shot", "--label", "Shot Number", "--type", "2",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-custom-metadata-field",
        "args": {"name": "Shot", "label": "Shot Number", "type": 2},
    }


def test_main_import_sequences_from_project_sends_ids(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "import-sequences-from-project",
            "--project-path", "/tmp/source.prproj", "--sequence-ids", '["id1", "id2"]',
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "import-sequences-from-project",
        "args": {"projectPath": "/tmp/source.prproj", "sequenceIds": ["id1", "id2"]},
    }


def test_main_import_sequences_from_project_rejects_invalid_json(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "import-sequences-from-project",
            "--project-path", "/tmp/source.prproj", "--sequence-ids", "not-json",
        ],
    )

    with pytest.raises(SystemExit) as exc_info:
        premiere_cli.main()

    assert exc_info.value.code == 2


def test_main_import_fcp_xml_sends_xml_path(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "import-fcp-xml", "--xml-path", "/tmp/cut.xml"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "import-fcp-xml", "args": {"xmlPath": "/tmp/cut.xml"}}


def test_main_import_ae_comps_sends_comp_names_and_bin(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "import-ae-comps",
            "--aep-path", "/tmp/title.aep", "--comp-names", '["Comp 1"]',
            "--target-bin-path", "B-Roll/AE",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "import-ae-comps",
        "args": {"aepPath": "/tmp/title.aep", "compNames": ["Comp 1"], "targetBinPath": "B-Roll/AE"},
    }


def test_main_create_bars_and_tone_sends_dimensions(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "create-bars-and-tone", "--width", "1920", "--height", "1080"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "create-bars-and-tone", "args": {"width": 1920, "height": 1080}}


def test_main_set_transcode_on_ingest_sends_enabled_bool(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-transcode-on-ingest", "--enabled", "true"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-transcode-on-ingest", "args": {"enabled": True}}


def test_main_set_project_panel_metadata_sends_metadata(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-project-panel-metadata", "--metadata", "<xml/>"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-project-panel-metadata", "args": {"metadata": "<xml/>"}}


def test_main_get_graphics_white_luminance_sends_no_args(monkeypatch, fake_panel):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "get-graphics-white-luminance"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "get-graphics-white-luminance", "args": {}}


def test_main_set_graphics_white_luminance_sends_value(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-graphics-white-luminance", "--value", "100"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "set-graphics-white-luminance", "args": {"value": 100.0}}


def test_main_duplicate_sequence_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "duplicate-sequence", "--new-name", "Copy of Main"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "duplicate-sequence", "args": {"newName": "Copy of Main"}}


def test_main_set_sequence_settings_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "set-sequence-settings",
            "--frame-rate", "24", "--width", "1920", "--height", "1080",
            "--par-numerator", "1", "--par-denominator", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-sequence-settings",
        "args": {"frameRate": 24.0, "width": 1920, "height": 1080, "parNumerator": 1.0, "parDenominator": 1.0},
    }


def test_main_set_sequence_settings_requires_at_least_one_field(monkeypatch, fake_panel, capsys):
    monkeypatch.setattr(sys, "argv", ["premiere-cli", "--port", str(fake_panel), "set-sequence-settings"])

    with pytest.raises(SystemExit):
        premiere_cli.main()

    assert "at least one of" in capsys.readouterr().err


def test_main_set_sequence_settings_requires_par_pair(monkeypatch, fake_panel, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "set-sequence-settings", "--par-numerator", "1"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    assert "--par-numerator and --par-denominator" in capsys.readouterr().err


def test_main_create_subsequence_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "create-subsequence", "--ignore-track-targeting", "true"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "create-subsequence", "args": {"ignoreTrackTargeting": True}}


def test_main_auto_reframe_sequence_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "auto-reframe-sequence",
            "--numerator", "9", "--denominator", "16",
            "--motion-preset", "default", "--new-name", "Vertical Cut", "--nest", "false",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "auto-reframe-sequence",
        "args": {
            "numerator": 9.0, "denominator": 16.0, "motionPreset": "default",
            "newName": "Vertical Cut", "nest": False,
        },
    }


def test_main_create_sequence_from_preset_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "create-sequence-from-preset",
            "--name", "My Seq", "--preset-path", "/tmp/custom.sqpreset",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "create-sequence-from-preset", "args": {"name": "My Seq", "presetPath": "/tmp/custom.sqpreset"}}


def test_main_create_sequence_from_clips_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "create-sequence-from-clips",
            "--name", "Assembled", "--node-ids", '["1", "2"]', "--target-bin-path", "B-Roll",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "create-sequence-from-clips",
        "args": {"name": "Assembled", "nodeIds": ["1", "2"], "targetBinPath": "B-Roll"},
    }


def test_main_create_sequence_from_clips_rejects_invalid_json(monkeypatch, fake_panel, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "create-sequence-from-clips", "--name", "X", "--node-ids", "not json"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    assert "not valid JSON" in capsys.readouterr().err


def test_main_attach_custom_property_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "attach-custom-property", "--property-id", "myKey", "--value", "myValue"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "attach-custom-property", "args": {"propertyId": "myKey", "value": "myValue"}}


def test_main_close_sequence_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "close-sequence", "--sequence-name", "Old Cut"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "close-sequence", "args": {"sequenceName": "Old Cut"}}


def test_main_export_sequence_as_project_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "export-sequence-as-project", "--output-path", "/tmp/out.prproj"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "export-sequence-as-project", "args": {"outputPath": "/tmp/out.prproj"}}


def test_main_scene_edit_detection_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel), "scene-edit-detection",
            "--mode", "CreateMarkers", "--apply-to-linked-audio", "true", "--sensitivity", "High",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "scene-edit-detection",
        "args": {"mode": "CreateMarkers", "applyToLinkedAudio": True, "sensitivity": "High"},
    }


def test_main_export_sequence_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "export-sequence", "--output", "/tmp/out.mp4", "--preset-path", "/tmp/x.epr", "--range", "in-to-out",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "export-sequence",
        "args": {"outputPath": "/tmp/out.mp4", "presetPath": "/tmp/x.epr", "range": "in-to-out"},
    }


def test_main_export_fcp_xml_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "export-fcp-xml", "--output", "/tmp/out.xml"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "export-fcp-xml", "args": {"outputPath": "/tmp/out.xml"}}


def test_main_export_aaf_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "export-aaf", "--output", "/tmp/out.aaf", "--mixdown", "false", "--mono", "true", "--rate", "44100", "--bits", "24",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "export-aaf",
        "args": {"outputPath": "/tmp/out.aaf", "mixdown": False, "mono": True, "rate": 44100, "bits": 24},
    }


def test_main_export_omf_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "export-omf", "--output", "/tmp/out.omf"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "export-omf", "args": {"outputPath": "/tmp/out.omf"}}


def test_main_add_to_render_queue_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "add-to-render-queue", "--output", "/tmp/q.mp4", "--preset-path", "/tmp/q.epr", "--start-batch", "true",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-to-render-queue",
        "args": {"outputPath": "/tmp/q.mp4", "presetPath": "/tmp/q.epr", "startBatch": True},
    }


def test_main_create_subclip_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "create-subclip", "--node-id", "abc123", "--subclip-name", "My Sub", "--in-seconds", "1.5", "--out-seconds", "3.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "create-subclip",
        "args": {"nodeId": "abc123", "subclipName": "My Sub", "inSeconds": 1.5, "outSeconds": 3.0},
    }


def test_main_encode_project_item_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "encode-project-item", "--name", "My Clip", "--output", "/tmp/e.mp4", "--preset-path", "/tmp/e.epr",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "encode-project-item",
        "args": {"name": "My Clip", "outputPath": "/tmp/e.mp4", "presetPath": "/tmp/e.epr"},
    }


def test_main_encode_file_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "encode-file", "--input", "/tmp/in.mov", "--output", "/tmp/out.mp4", "--preset-path", "/tmp/x.epr",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "encode-file",
        "args": {"inputPath": "/tmp/in.mov", "outputPath": "/tmp/out.mp4", "presetPath": "/tmp/x.epr"},
    }


def test_main_manage_proxies_attach_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli", "--port", str(fake_panel),
            "manage-proxies", "--action", "attach", "--node-id", "abc123", "--proxy-path", "/tmp/proxy.mov",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "manage-proxies",
        "args": {"action": "attach", "nodeId": "abc123", "proxyPath": "/tmp/proxy.mov"},
    }


def test_main_manage_proxies_enable_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "manage-proxies", "--action", "enable"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "manage-proxies", "args": {"action": "enable"}}


def test_main_open_in_source_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "open-in-source", "--node-id", "abc123"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "open-in-source", "args": {"nodeId": "abc123"}}


def test_main_close_source_monitor_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "close-source-monitor"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "close-source-monitor", "args": {}}


def test_main_close_all_source_clips_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        ["premiere-cli", "--port", str(fake_panel), "close-all-source-clips"],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {"command": "close-all-source-clips", "args": {}}


def test_main_set_source_in_out_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "set-source-in-out",
            "--in-seconds", "1.5",
            "--out-seconds", "3.5",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "set-source-in-out",
        "args": {"inSeconds": 1.5, "outSeconds": 3.5},
    }


def test_main_insert_from_source_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "insert-from-source",
            "--track-type", "video",
            "--track-index", "0",
            "--at-seconds", "2.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "insert-from-source",
        "args": {"trackType": "video", "trackIndex": 0, "atSeconds": 2.0},
    }


def test_main_overwrite_from_source_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "overwrite-from-source",
            "--track-type", "audio",
            "--track-index", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "overwrite-from-source",
        "args": {"trackType": "audio", "trackIndex": 1},
    }


def test_main_add_text_overlay_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "add-text-overlay",
            "--text", "Hello world",
            "--start-seconds", "1.0",
            "--duration-seconds", "4.0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "add-text-overlay",
        "args": {"text": "Hello world", "startSeconds": 1.0, "durationSeconds": 4.0},
    }


def test_main_import_mogrt_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "import-mogrt",
            "--mogrt-path", "/path/to/template.mogrt",
            "--start-seconds", "0.0",
            "--video-track-index", "0",
            "--audio-track-index", "0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "import-mogrt",
        "args": {
            "mogrtPath": "/path/to/template.mogrt",
            "startSeconds": 0.0,
            "videoTrackIndex": 0,
            "audioTrackIndex": 0,
        },
    }


def test_main_import_mogrt_from_library_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "import-mogrt-from-library",
            "--library-name", "My Library",
            "--mogrt-name", "Lower Third",
            "--start-seconds", "0.0",
            "--video-track-index", "0",
            "--audio-track-index", "0",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "import-mogrt-from-library",
        "args": {
            "libraryName": "My Library",
            "mogrtName": "Lower Third",
            "startSeconds": 0.0,
            "videoTrackIndex": 0,
            "audioTrackIndex": 0,
        },
    }


def test_main_get_mogrt_component_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "get-mogrt-component",
            "--track-type", "video",
            "--track-index", "0",
            "--clip-index", "1",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "get-mogrt-component",
        "args": {"trackType": "video", "trackIndex": 0, "clipIndex": 1},
    }


def test_main_create_caption_track_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "create-caption-track",
            "--node-id", "srt123",
            "--start-seconds", "0.0",
            "--format", "subtitle",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "create-caption-track",
        "args": {"nodeId": "srt123", "startSeconds": 0.0, "format": "subtitle"},
    }


def test_main_replace_clip_media_sends_correct_args(monkeypatch, fake_panel):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "premiere-cli",
            "--port", str(fake_panel),
            "replace-clip-media",
            "--name", "Old Clip",
            "--new-media-path", "/path/to/new-media.mp4",
        ],
    )

    with pytest.raises(SystemExit):
        premiere_cli.main()

    _, body = _RecordingHandler.received[0]
    assert body == {
        "command": "replace-clip-media",
        "args": {"name": "Old Clip", "newMediaPath": "/path/to/new-media.mp4"},
    }
