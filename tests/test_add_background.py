"""Tests for planning a looped background fill."""

import pytest

from premiere_cli.add_background import clip_intervals, plan_fill


def spans(pairs):
    return [{"start": s, "end": e} for s, e in pairs]


class TestClipIntervals:
    def test_passes_intervals_through_untouched_without_a_range(self):
        given = spans([(1.0, 2.0), (5.0, 6.0)])
        assert clip_intervals(given, None, None) == given

    def test_drops_intervals_entirely_before_the_range(self):
        assert clip_intervals(spans([(1.0, 2.0), (10.0, 11.0)]), 5.0, None) == spans([(10.0, 11.0)])

    def test_drops_intervals_entirely_after_the_range(self):
        assert clip_intervals(spans([(1.0, 2.0), (10.0, 11.0)]), None, 5.0) == spans([(1.0, 2.0)])

    def test_truncates_an_interval_straddling_the_start(self):
        assert clip_intervals(spans([(1.0, 8.0)]), 5.0, None) == spans([(5.0, 8.0)])

    def test_truncates_an_interval_straddling_the_end(self):
        assert clip_intervals(spans([(1.0, 8.0)]), None, 5.0) == spans([(1.0, 5.0)])

    def test_truncates_both_ends(self):
        assert clip_intervals(spans([(0.0, 20.0)]), 5.0, 9.0) == spans([(5.0, 9.0)])

    def test_drops_an_interval_that_collapses_to_nothing(self):
        assert clip_intervals(spans([(5.0, 5.2)]), 5.2, None) == []

    def test_empty(self):
        assert clip_intervals([], 1.0, 2.0) == []


class TestPlanFill:
    def test_a_span_shorter_than_the_source_is_one_trimmed_placement(self):
        placements = plan_fill(spans([(10.0, 13.0)]), source_duration=8.0, fps=25)
        assert placements == [{"start": 10.0, "out": 3.0, "trimmed": True}]

    def test_a_span_exactly_the_source_length_is_one_full_placement(self):
        placements = plan_fill(spans([(0.0, 8.0)]), source_duration=8.0, fps=25)
        assert placements == [{"start": 0.0, "out": 8.0, "trimmed": False}]

    def test_a_longer_span_repeats_the_source_and_trims_the_last(self):
        placements = plan_fill(spans([(0.0, 20.0)]), source_duration=8.0, fps=25)
        assert [p["start"] for p in placements] == [0.0, 8.0, 16.0]
        assert [p["out"] for p in placements] == [8.0, 8.0, 4.0]
        assert [p["trimmed"] for p in placements] == [False, False, True]

    def test_repeats_tile_the_span_without_gaps_or_overlap(self):
        placements = plan_fill(spans([(3.0, 30.0)]), source_duration=6.0, fps=25)
        for earlier, later in zip(placements, placements[1:]):
            assert earlier["start"] + earlier["out"] == pytest.approx(later["start"])
        last = placements[-1]
        assert last["start"] + last["out"] == pytest.approx(30.0)

    def test_an_exact_multiple_leaves_no_trimmed_placement(self):
        placements = plan_fill(spans([(0.0, 16.0)]), source_duration=8.0, fps=25)
        assert len(placements) == 2
        assert not any(p["trimmed"] for p in placements)

    def test_each_span_is_filled_independently(self):
        placements = plan_fill(spans([(0.0, 4.0), (100.0, 104.0)]), source_duration=8.0, fps=25)
        assert [p["start"] for p in placements] == [0.0, 100.0]

    def test_lengths_are_quantised_to_whole_frames(self):
        # 5.0/3 would be 1.666…s; every placement must land on a frame so the
        # fill cannot drift sub-frame and leave a one-frame hole.
        placements = plan_fill(spans([(0.0, 5.0)]), source_duration=1.6667, fps=25)
        for p in placements:
            assert p["out"] * 25 == pytest.approx(round(p["out"] * 25), abs=1e-6)
            assert p["start"] * 25 == pytest.approx(round(p["start"] * 25), abs=1e-6)

    def test_a_remainder_under_one_frame_is_dropped(self):
        placements = plan_fill(spans([(0.0, 8.02)]), source_duration=8.0, fps=25)
        assert len(placements) == 1
        assert placements[0]["out"] == pytest.approx(8.0)

    def test_rejects_a_non_positive_source_duration(self):
        with pytest.raises(ValueError):
            plan_fill(spans([(0.0, 5.0)]), source_duration=0.0, fps=25)

    def test_no_spans(self):
        assert plan_fill([], source_duration=8.0, fps=25) == []


# --- the driver, against a fake panel -------------------------------------


class FakePanel:
    """Records every command submitted, and answers the reads."""

    def __init__(self, out_point=8.0, fps=25, items=None, fail=None):
        self.calls = []
        self.out_point = out_point
        self.fps = fps
        self.items = items if items is not None else [
            {"name": "bg.mov", "nodeId": "n1", "isSequence": False}
        ]
        self.fail = fail or set()

    def __call__(self, command, args):
        self.calls.append((command, args))
        if command in self.fail:
            return {"ok": False, "error": "boom"}
        if command == "search-project-items":
            return {"ok": True, "result": {"items": self.items}}
        if command == "get-project-item-info":
            return {"ok": True, "result": {"inPointSeconds": 0.0, "outPointSeconds": self.out_point}}
        if command == "get-project-info":
            return {"ok": True, "result": {"sequences": [{"name": "final cut", "frameRate": self.fps}]}}
        return {"ok": True, "result": {}}

    def of(self, command):
        return [a for c, a in self.calls if c == command]


def _run(panel, **kw):
    from premiere_cli import add_background
    defaults = dict(
        sequence_name="final cut", track_index=1, item_node_id=None, item_name="bg.mov",
        intervals=spans([(0.0, 20.0)]), start_seconds=None, end_seconds=None,
        source_duration_seconds=None, fps=None, dry_run=False,
    )
    defaults.update(kw)
    return add_background.run(panel, **defaults)


def test_run_places_each_repeat_and_trims_the_last():
    panel = FakePanel(out_point=8.0)
    res = _run(panel)
    assert res["ok"], res
    assert res["result"]["placed"] == 3
    assert res["result"]["trimmed"] == 1
    starts = [a["startSeconds"] for a in panel.of("overwrite-clip-at")]
    assert starts == [0.0, 8.0, 16.0]
    outs = [a["outSeconds"] for a in panel.of("set-item-in-out")]
    assert outs[:3] == [8.0, 8.0, 4.0]


def test_run_places_on_the_requested_video_track_only():
    panel = FakePanel()
    _run(panel, track_index=2)
    for args in panel.of("overwrite-clip-at"):
        assert args["trackType"] == "video"
        assert args["trackIndex"] == 2


def test_run_restores_the_source_in_out_afterwards():
    panel = FakePanel(out_point=8.0)
    res = _run(panel)
    assert res["result"]["sourceInOutRestored"] is True
    # the final set-item-in-out puts the original out point back
    assert panel.of("set-item-in-out")[-1]["outSeconds"] == 8.0


def test_run_honours_a_time_range():
    panel = FakePanel(out_point=8.0)
    _run(panel, intervals=spans([(0.0, 40.0)]), start_seconds=10.0, end_seconds=18.0)
    starts = [a["startSeconds"] for a in panel.of("overwrite-clip-at")]
    assert starts == [10.0]
    assert panel.of("set-item-in-out")[0]["outSeconds"] == 8.0


def test_run_uses_the_sequence_frame_rate_not_the_source_s():
    panel = FakePanel(out_point=8.0, fps=25)
    res = _run(panel)
    assert res["result"]["fps"] == 25


def test_dry_run_places_nothing():
    panel = FakePanel()
    res = _run(panel, dry_run=True)
    assert res["result"]["dryRun"] is True
    assert panel.of("overwrite-clip-at") == []
    assert panel.of("set-item-in-out") == []
    assert len(res["result"]["placementList"]) == 3


def test_run_errors_when_the_name_is_ambiguous():
    panel = FakePanel(items=[
        {"name": "bg.mov", "nodeId": "n1", "isSequence": False},
        {"name": "bg.mov", "nodeId": "n2", "isSequence": False},
    ])
    res = _run(panel)
    assert not res["ok"]
    assert "--item-node-id" in res["error"]


def test_run_errors_when_the_item_is_missing():
    panel = FakePanel(items=[])
    res = _run(panel)
    assert not res["ok"]
    assert "no project item" in res["error"]


def test_run_reports_a_placement_failure_without_stopping():
    panel = FakePanel(out_point=8.0, fail={"overwrite-clip-at"})
    res = _run(panel)
    assert not res["ok"]
    assert res["result"]["failureCount"] == 3
    assert res["result"]["placed"] == 0
    # and the source item is still restored
    assert res["result"]["sourceInOutRestored"] is True


def test_run_accepts_an_explicit_source_duration():
    panel = FakePanel(out_point=8.0)
    _run(panel, source_duration_seconds=5.0, intervals=spans([(0.0, 12.0)]))
    assert [a["outSeconds"] for a in panel.of("set-item-in-out")][:3] == [5.0, 5.0, 2.0]


def test_timecode_to_seconds():
    from premiere_cli.cli import _timecode_to_seconds
    assert _timecode_to_seconds("00:00:00", 25) == 0.0
    assert _timecode_to_seconds("00:01:00", 25) == 1.0
    assert _timecode_to_seconds("00:01:12", 25) == pytest.approx(1.48)
    assert _timecode_to_seconds("01:01:01", 25) == pytest.approx(61.04)
