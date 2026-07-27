"""Fill spans of a timeline with a looped background clip.

Composed from existing panel commands rather than added as a new one:
`set-item-in-out` controls how much of the source is placed, and
`overwrite-clip-at` puts it on the timeline. That reuses
`overwrite-clip-at`'s verified placement path — including its cleanup of the
auto-linked audio Premiere silently drops onto an audio track — and needs no
panel reload.

Which spans to fill is the caller's business: pass them in a cuts-style
intervals file. The spans a *video project* wants (say, every motion graphic
with no talking head behind it) come from that project's own script metadata,
which this package knows nothing about.
"""

from __future__ import annotations

from typing import Optional

#: Anything shorter than this many frames is not worth an edit point.
MIN_PLACEMENT_FRAMES = 1


def clip_intervals(
    intervals: list[dict], start: Optional[float], end: Optional[float]
) -> list[dict]:
    """Restrict intervals to [start, end], dropping and truncating as needed."""
    out = []
    for interval in intervals:
        lo, hi = interval["start"], interval["end"]
        if start is not None:
            lo = max(lo, start)
        if end is not None:
            hi = min(hi, end)
        if hi > lo:
            out.append({"start": lo, "end": hi})
    return out


def plan_fill(intervals: list[dict], source_duration: float, fps: float) -> list[dict]:
    """Plan the placements that tile each interval with the source clip.

    The source repeats until the span is full and the final repeat is trimmed,
    so a span is covered exactly — no gap, no overhang. Every start and length
    is quantised to a whole frame: at sub-frame precision the repeats drift and
    leave a one-frame hole between them.
    """
    if source_duration <= 0:
        raise ValueError("source_duration must be positive")

    frame = 1.0 / fps
    loop_frames = max(1, int(round(source_duration * fps)))
    placements = []
    for interval in intervals:
        start_frame = int(round(interval["start"] * fps))
        end_frame = int(round(interval["end"] * fps))
        cursor = start_frame
        while cursor < end_frame:
            remaining = end_frame - cursor
            length = min(loop_frames, remaining)
            if length < MIN_PLACEMENT_FRAMES:
                break
            placements.append(
                {
                    "start": round(cursor * frame, 6),
                    "out": round(length * frame, 6),
                    "trimmed": length < loop_frames,
                }
            )
            cursor += length
    return placements


def summarise(placements: list[dict]) -> dict:
    """Counts a caller can report without re-deriving them."""
    return {
        "placements": len(placements),
        "trimmed": sum(1 for p in placements if p["trimmed"]),
        "total_seconds": round(sum(p["out"] for p in placements), 3),
    }


def run(
    submit,
    sequence_name: Optional[str],
    track_index: int,
    item_node_id: Optional[str],
    item_name: Optional[str],
    intervals: list[dict],
    start_seconds: Optional[float],
    end_seconds: Optional[float],
    source_duration_seconds: Optional[float],
    fps: Optional[float],
    dry_run: bool,
) -> dict:
    """Resolve the source clip, plan the fill, and place it.

    `submit` is the panel client (command, args) -> response dict, injected so
    this is testable against a fake panel.
    """
    # --- resolve the source item ------------------------------------------
    node_id = item_node_id
    if node_id is None:
        found = submit("search-project-items", {"nameContains": item_name})
        if not found.get("ok"):
            return {"ok": False, "error": f"could not search for {item_name!r}: {found.get('error')}"}
        matches = [
            i for i in (found["result"].get("items") or [])
            if i.get("name") == item_name and not i.get("isSequence")
        ]
        if not matches:
            return {"ok": False, "error": f"no project item named {item_name!r}"}
        if len(matches) > 1:
            return {
                "ok": False,
                "error": f"{len(matches)} project items are named {item_name!r} — pass --item-node-id",
            }
        node_id = matches[0]["nodeId"]

    info = submit("get-project-item-info", {"nodeId": node_id})
    if not info.get("ok"):
        return {"ok": False, "error": f"could not read the source item: {info.get('error')}"}
    item = info["result"]
    original_in = item.get("inPointSeconds") or 0.0
    original_out = item.get("outPointSeconds")

    duration = source_duration_seconds
    if duration is None:
        if original_out is None:
            return {
                "ok": False,
                "error": "the source item reports no out point — pass --source-duration-seconds",
            }
        duration = original_out - original_in
    if duration <= 0:
        return {"ok": False, "error": f"source duration is not positive ({duration})"}

    # --- frame grid: the SEQUENCE's, not the source's ---------------------
    if fps is None:
        project = submit("get-project-info", {})
        if not project.get("ok"):
            return {"ok": False, "error": f"could not read the project: {project.get('error')}"}
        sequences = project["result"].get("sequences") or []
        target = sequence_name or (sequences[0]["name"] if sequences else None)
        match = next((s for s in sequences if s["name"] == target), None)
        if match is None:
            return {"ok": False, "error": f"no sequence named {target!r} is open"}
        fps = float(match["frameRate"])

    spans = clip_intervals(intervals, start_seconds, end_seconds)
    placements = plan_fill(spans, duration, fps)
    plan = {
        "sequenceName": sequence_name,
        "trackIndex": track_index,
        "itemNodeId": node_id,
        "sourceDurationSeconds": round(duration, 3),
        "fps": fps,
        "spans": len(spans),
        **summarise(placements),
    }
    if dry_run:
        return {"ok": True, "result": {**plan, "dryRun": True, "placementList": placements}}

    # --- place ------------------------------------------------------------
    placed, failures = 0, []
    for p in placements:
        trim = submit(
            "set-item-in-out",
            {"nodeId": node_id, "inSeconds": original_in,
             "outSeconds": round(original_in + p["out"], 6), "mediaType": 1},
        )
        if not trim.get("ok"):
            failures.append({"start": p["start"], "stage": "set-item-in-out", "error": trim.get("error")})
            continue
        put = submit(
            "overwrite-clip-at",
            {"itemNodeId": node_id, "trackType": "video", "trackIndex": track_index,
             "startSeconds": p["start"], "sequenceName": sequence_name},
        )
        if put.get("ok"):
            placed += 1
        else:
            failures.append({"start": p["start"], "stage": "overwrite-clip-at", "error": put.get("error")})

    # Leave the source item as we found it — a trimmed out point would silently
    # shorten every later use of this clip.
    restored = True
    if original_out is not None:
        restore = submit(
            "set-item-in-out",
            {"nodeId": node_id, "inSeconds": original_in, "outSeconds": original_out, "mediaType": 1},
        )
        restored = bool(restore.get("ok"))

    return {
        "ok": not failures,
        "result": {**plan, "placed": placed, "sourceInOutRestored": restored,
                   "failureCount": len(failures), "failures": failures[:10]},
    }
