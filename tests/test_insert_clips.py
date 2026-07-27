"""Tests for placing timestamp-named clips onto a track."""

import pytest

from premiere_cli.insert_clips import parse_leading_timecode, plan_inserts, run


class TestParseLeadingTimecode:
    @pytest.mark.parametrize("name,seconds", [
        ("00-00-00 - motion graphic - x.mov", 0.0),
        ("00-08-00 - motion graphic - x.mov", 8.0),
        ("00-32-02 - motion graphic - x.mov", 32.08),
        ("06-51-13 - motion graphic - x.mov", 411.52),
        ("12-30-24 - anything.mp4", 750.96),
    ])
    def test_parses_mm_ss_ff(self, name, seconds):
        assert parse_leading_timecode(name, 25) == pytest.approx(seconds)

    def test_requires_the_timestamp_at_the_start(self):
        assert parse_leading_timecode("clip 00-08-00 - x.mov", 25) is None

    def test_rejects_a_name_without_a_timestamp(self):
        assert parse_leading_timecode("main-camera.mp4", 25) is None

    def test_rejects_a_partial_timestamp(self):
        assert parse_leading_timecode("00-08 - x.mov", 25) is None

    def test_frames_beyond_the_frame_rate_are_rejected(self):
        # 00-00-30 at 25fps is not a valid timecode; silently taking it as 1.2s
        # would place the clip somewhere nobody asked for.
        assert parse_leading_timecode("00-00-30 - x.mov", 25) is None

    def test_frames_at_the_limit_are_accepted(self):
        assert parse_leading_timecode("00-00-24 - x.mov", 25) == pytest.approx(0.96)


class TestPlanInserts:
    def items(self, *names):
        return [{"name": n, "nodeId": f"n{i}"} for i, n in enumerate(names)]

    def test_only_timestamped_items_are_planned(self):
        plan, skipped = plan_inserts(
            self.items("00-08-00 - a.mov", "notes.txt", "main-camera.mp4"), 25)
        assert [p["name"] for p in plan] == ["00-08-00 - a.mov"]
        assert sorted(skipped) == ["main-camera.mp4", "notes.txt"]

    def test_plan_is_ordered_by_time(self):
        plan, _ = plan_inserts(
            self.items("06-51-13 - c.mov", "00-08-00 - a.mov", "00-32-02 - b.mov"), 25)
        assert [p["startSeconds"] for p in plan] == [8.0, 32.08, 411.52]

    def test_start_seconds_come_from_the_name(self):
        [plan], _ = plan_inserts(self.items("01-01-03 - x.mov"), 25)
        assert plan["startSeconds"] == pytest.approx(61.12)

    def test_empty(self):
        assert plan_inserts([], 25) == ([], [])


class FakePanel:
    def __init__(self, items, fps=25, audio_clips=0, fail=None):
        self.calls = []
        self.items = items
        self.fps = fps
        self.audio_clips = audio_clips
        self.fail = fail or set()

    def __call__(self, command, args):
        self.calls.append((command, args))
        if command in self.fail:
            return {"ok": False, "error": "boom"}
        if command == "get-bin-contents":
            return {"ok": True, "result": {"items": self.items}}
        if command == "get-project-info":
            return {"ok": True, "result": {"sequences": [{"name": "final cut", "frameRate": self.fps}]}}
        if command == "get-timeline-summary":
            return {"ok": True, "result": {
                "videoTracks": [{"index": 0, "name": "Video 1", "clipCount": 0},
                                {"index": 1, "name": "Video 2", "clipCount": 0}],
                "audioTracks": [{"index": 0, "name": "Audio 1", "clipCount": self.audio_clips}]}}
        return {"ok": True, "result": {}}

    def of(self, command):
        return [a for c, a in self.calls if c == command]


def _run(panel, **kw):
    defaults = dict(sequence_name="final cut", bin_path="motion graphics",
                    track_type="video", track_index=2, fps=None, dry_run=False)
    defaults.update(kw)
    return run(panel, **defaults)


class TestRun:
    def test_places_every_timestamped_clip(self):
        panel = FakePanel([{"name": "00-08-00 - a.mov", "nodeId": "n1"},
                           {"name": "00-32-02 - b.mov", "nodeId": "n2"}])
        res = _run(panel)
        assert res["ok"]
        assert res["result"]["placed"] == 2
        placed = panel.of("overwrite-clip-at")
        assert [p["startSeconds"] for p in placed] == [8.0, 32.08]
        assert all(p["trackIndex"] == 2 and p["trackType"] == "video" for p in placed)

    def test_untimestamped_items_are_skipped_and_reported(self):
        panel = FakePanel([{"name": "00-08-00 - a.mov", "nodeId": "n1"},
                           {"name": "background.mp4", "nodeId": "n2"}])
        res = _run(panel)
        assert res["result"]["skipped"] == ["background.mp4"]
        assert len(panel.of("overwrite-clip-at")) == 1

    def test_dry_run_places_nothing(self):
        panel = FakePanel([{"name": "00-08-00 - a.mov", "nodeId": "n1"}])
        res = _run(panel, dry_run=True)
        assert panel.of("overwrite-clip-at") == []
        assert res["result"]["dryRun"] is True

    def test_uses_the_sequence_frame_rate_when_none_is_given(self):
        panel = FakePanel([{"name": "00-00-12 - a.mov", "nodeId": "n1"}], fps=25)
        res = _run(panel)
        assert res["result"]["fps"] == 25
        assert panel.of("overwrite-clip-at")[0]["startSeconds"] == pytest.approx(0.48)

    def test_reports_when_the_audio_track_gained_clips(self):
        # Placing video auto-links the source's audio onto A1, destroying what
        # was there. The count changing is the tell.
        class Changing(FakePanel):
            def __call__(self, command, args):
                r = super().__call__(command, args)
                if command == "get-timeline-summary":
                    self.audio_clips += 3
                return r
        panel = Changing([{"name": "00-08-00 - a.mov", "nodeId": "n1"}], audio_clips=6)
        res = _run(panel)
        assert res["result"]["audioTracksChanged"] is True

    def test_no_timestamped_clips_is_not_an_error(self):
        panel = FakePanel([{"name": "main-camera.mp4", "nodeId": "n1"}])
        res = _run(panel)
        assert res["ok"]
        assert res["result"]["placed"] == 0

    def test_a_failed_placement_is_reported_without_stopping(self):
        panel = FakePanel([{"name": "00-08-00 - a.mov", "nodeId": "n1"},
                           {"name": "00-32-02 - b.mov", "nodeId": "n2"}],
                          fail={"overwrite-clip-at"})
        res = _run(panel)
        assert not res["ok"]
        assert res["result"]["failureCount"] == 2
