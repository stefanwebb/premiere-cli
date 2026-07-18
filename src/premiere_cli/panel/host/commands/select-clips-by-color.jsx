// Command: select-clips-by-color → ppb_selectClipsByColor
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM only — no QE needed. Ported from leancoderkavy's
// premiere-pro-mcp `select_clips_by_color` tool (selection.ts): selects
// every clip whose source projectItem's color label
// (projectItem.getColorLabel()) matches colorLabel (0-15). If
// getColorLabel isn't available on this Premiere build, degrades honestly
// (same pattern as search-project-items' colorLabel filter) rather than
// silently reporting zero matches. Mutation — verified via
// seq.getSelection() afterward.

function ppb_selectClipsByColorCollectSelection(seq) {
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

function ppb_selectClipsByColor(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.colorLabel !== "number" || args.colorLabel < 0 || args.colorLabel > 15 || Math.floor(args.colorLabel) !== args.colorLabel) {
      return JSON.stringify({ ok: false, error: "colorLabel must be an integer 0-15" });
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

    // null = not yet determined, true = confirmed available, false = confirmed unavailable
    var apiAvailable = null;

    function scanTracksForColor(tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
          var clip = track.clips[c];
          var projectItem = null;
          try { projectItem = clip.projectItem; } catch (e) { projectItem = null; }
          if (!projectItem) {
            continue;
          }
          try {
            var label = projectItem.getColorLabel();
            apiAvailable = true;
            if (label === args.colorLabel) {
              try { clip.setSelected(true, true); } catch (e2) { /* best-effort */ }
            }
          } catch (e) {
            if (apiAvailable === null) {
              apiAvailable = false;
            }
          }
        }
      }
    }

    scanTracksForColor(seq.videoTracks);
    scanTracksForColor(seq.audioTracks);

    if (apiAvailable === false) {
      return JSON.stringify({ ok: false, error: "getColorLabel is not available on this Premiere build" });
    }

    var selectionResult = ppb_selectClipsByColorCollectSelection(seq);

    var result = {
      sequenceName: seq.name,
      colorLabel: args.colorLabel
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
