"""Place already-imported clips whose names begin with their insertion time.

A delivered motion graphic is named ``MM-SS-FF - <type> - <description>.mov``,
where the leading field is where it belongs on the timeline. This reads one
bin, takes every item whose name starts with such a timecode, and overwrites it
onto the given track at that time. Items without a leading timecode are skipped
and named in the report rather than guessed at.

Composed from existing panel commands (``get-bin-contents``,
``overwrite-clip-at``), so it needs no panel reload.

**A source with an audio stream will destroy audio underneath it.** Premiere
auto-links a source's audio onto A1 whenever its video is placed, and the
overwrite takes whatever was there; `-1` does not suppress it on PPro 2026 (see
PREMIERE_API_NOTES.md). This command therefore snapshots the audio tracks before
and after and reports if their clip counts changed — it cannot prevent the
damage, only tell you it happened.
"""

from __future__ import annotations

import re
from typing import Optional

#: MM-SS-FF at the very start of the name, then a separator.
_TIMECODE_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{2})(?=[\s._-]|$)")


def parse_leading_timecode(name: str, fps: float) -> Optional[float]:
    """Seconds for a name beginning ``MM-SS-FF``, or None if it does not.

    A frame field at or beyond `fps` is rejected rather than folded into the
    next second: it means the name was not written against this sequence, and
    silently placing the clip a second late is worse than skipping it.
    """
    match = _TIMECODE_RE.match(name)
    if not match:
        return None
    minutes, seconds, frames = (int(g) for g in match.groups())
    if frames >= round(fps) or seconds >= 60:
        return None
    return minutes * 60 + seconds + frames / fps


def plan_inserts(items: list[dict], fps: float) -> tuple[list[dict], list[str]]:
    """Split a bin's items into a time-ordered placement plan and the skipped."""
    plan, skipped = [], []
    for item in items:
        name = item.get("name") or ""
        at = parse_leading_timecode(name, fps)
        if at is None:
            skipped.append(name)
            continue
        plan.append({"name": name, "nodeId": item.get("nodeId"), "startSeconds": round(at, 6)})
    plan.sort(key=lambda p: p["startSeconds"])
    return plan, skipped


def _audio_snapshot(submit, sequence_name: Optional[str]) -> Optional[list[int]]:
    args = {"sequenceName": sequence_name} if sequence_name else {}
    response = submit("get-timeline-summary", args)
    if not response.get("ok"):
        return None
    return [t.get("clipCount") for t in (response["result"].get("audioTracks") or [])]


def run(
    submit,
    sequence_name: Optional[str],
    bin_path: str,
    track_type: str,
    track_index: int,
    fps: Optional[float],
    dry_run: bool,
) -> dict:
    """Read `bin_path` and place its timestamped clips onto the track."""
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

    contents = submit("get-bin-contents", {"binPath": bin_path})
    if not contents.get("ok"):
        return {"ok": False, "error": f"could not read bin {bin_path!r}: {contents.get('error')}"}
    result = contents.get("result") or {}
    items = result if isinstance(result, list) else result.get("items") or []
    items = [i for i in items if isinstance(i, dict) and i.get("type") != "BIN"]

    plan, skipped = plan_inserts(items, fps)
    summary = {
        "sequenceName": sequence_name, "binPath": bin_path, "trackType": track_type,
        "trackIndex": track_index, "fps": fps, "found": len(items),
        "timestamped": len(plan), "skipped": skipped,
    }
    if dry_run:
        return {"ok": True, "result": {**summary, "dryRun": True, "plan": plan}}

    before = _audio_snapshot(submit, sequence_name)
    placed, failures = 0, []
    for entry in plan:
        response = submit("overwrite-clip-at", {
            "itemNodeId": entry["nodeId"], "trackType": track_type,
            "trackIndex": track_index, "startSeconds": entry["startSeconds"],
            "sequenceName": sequence_name,
        })
        if response.get("ok"):
            placed += 1
        else:
            failures.append({"name": entry["name"], "startSeconds": entry["startSeconds"],
                             "error": response.get("error")})
    after = _audio_snapshot(submit, sequence_name)

    changed = None
    if before is not None and after is not None:
        changed = before != after

    return {
        "ok": not failures,
        "result": {**summary, "placed": placed,
                   "audioTracksBefore": before, "audioTracksAfter": after,
                   "audioTracksChanged": changed,
                   "failureCount": len(failures), "failures": failures[:10]},
    }
