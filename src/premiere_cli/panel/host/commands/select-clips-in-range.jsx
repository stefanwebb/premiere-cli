// Command: select-clips-in-range → ppb_selectClipsInRange
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM only (clip.setSelected(bool, true)) — no QE needed. Ported
// from leancoderkavy's premiere-pro-mcp `select_clips_in_range` tool
// (selection.ts): a clip qualifies if it OVERLAPS the given range
// (clipStart < rangeEnd && clipEnd > rangeStart), not merely contained by
// it. Mutation — verified via seq.getSelection() afterward.

function ppb_selectClipsInRangeCollectSelection(seq) {
  var sel = null;
  try {
    sel = seq.getSelection();
  } catch (e) {
    sel = null;
  }
  var selCount = 0;
  if (sel) {
    if (typeof sel.numItems === "number") {
      selCount = sel.numItems;
    } else if (typeof sel.length === "number") {
      selCount = sel.length;
    }
  }
  var selectedClips = [];
  var cap = selCount > 20 ? 20 : selCount;
  for (var i = 0; i < cap; i++) {
    var item = sel[i];
    var entry = { name: null, mediaType: null, startSeconds: null, endSeconds: null, nodeId: null };
    try { entry.name = item.name; } catch (e) { entry.name = null; }
    try { entry.mediaType = item.mediaType; } catch (e) { entry.mediaType = null; }
    try { entry.startSeconds = timeValueToSeconds(item.start); } catch (e) { entry.startSeconds = null; }
    try { entry.endSeconds = timeValueToSeconds(item.end); } catch (e) { entry.endSeconds = null; }
    try { entry.nodeId = item.nodeId; } catch (e) { entry.nodeId = null; }
    selectedClips.push(entry);
  }
  var result = { selectedCount: selCount, selectedClips: selectedClips };
  if (selCount > 20) {
    result.truncated = true;
  }
  return result;
}

function ppb_selectClipsInRange(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.startSeconds !== "number" || !isFinite(args.startSeconds) || args.startSeconds < 0) {
      return JSON.stringify({ ok: false, error: "startSeconds must be a non-negative number" });
    }
    if (typeof args.endSeconds !== "number" || !isFinite(args.endSeconds) || args.endSeconds < 0) {
      return JSON.stringify({ ok: false, error: "endSeconds must be a non-negative number" });
    }
    if (args.endSeconds <= args.startSeconds) {
      return JSON.stringify({ ok: false, error: "endSeconds must be greater than startSeconds" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var seq = null;
    if (args.sequenceName && typeof args.sequenceName === "string") {
      seq = findSequenceByName(args.sequenceName);
      if (!seq) {
        return JSON.stringify({ ok: false, error: "no sequence named \"" + args.sequenceName + "\" is open" });
      }
    } else {
      seq = app.project.activeSequence;
      if (!seq) {
        return JSON.stringify({ ok: false, error: "no active sequence, and no sequenceName given" });
      }
    }

    function deselectAllInTracks(tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
          try { track.clips[c].setSelected(false, true); } catch (e) { /* best-effort */ }
        }
      }
    }

    deselectAllInTracks(seq.videoTracks);
    deselectAllInTracks(seq.audioTracks);

    function selectOverlappingInTracks(tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
          var clip = track.clips[c];
          var cs = null;
          var ce = null;
          try { cs = timeValueToSeconds(clip.start); } catch (e) { cs = null; }
          try { ce = timeValueToSeconds(clip.end); } catch (e) { ce = null; }
          if (cs === null || ce === null) {
            continue;
          }
          if (cs < args.endSeconds && ce > args.startSeconds) {
            try { clip.setSelected(true, true); } catch (e) { /* best-effort */ }
          }
        }
      }
    }

    selectOverlappingInTracks(seq.videoTracks);
    selectOverlappingInTracks(seq.audioTracks);

    var selectionResult = ppb_selectClipsInRangeCollectSelection(seq);

    var result = {
      sequenceName: seq.name,
      startSeconds: args.startSeconds,
      endSeconds: args.endSeconds
    };
    result.selectedCount = selectionResult.selectedCount;
    result.selectedClips = selectionResult.selectedClips;
    if (selectionResult.truncated) {
      result.truncated = true;
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
