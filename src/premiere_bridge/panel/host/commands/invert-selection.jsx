// Command: invert-selection → ppb_invertSelection
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM only (clip.isSelected() / setSelected(bool, true)) — no QE
// needed. Ported from leancoderkavy's premiere-pro-mcp `invert_selection`
// tool (selection.ts). A clip whose isSelected() throws is skipped
// entirely (left untouched) rather than guessed at. Mutation — verified
// via seq.getSelection() afterward.

function ppb_invertSelectionCollectSelection(seq) {
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

function ppb_invertSelection(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
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

    var skipped = 0;

    function invertTracks(tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
          var clip = track.clips[c];
          var wasSelected;
          try {
            wasSelected = clip.isSelected();
          } catch (e) {
            skipped++;
            continue;
          }
          try {
            clip.setSelected(!wasSelected, true);
          } catch (e) {
            // best-effort — clip left in its prior selection state
          }
        }
      }
    }

    invertTracks(seq.videoTracks);
    invertTracks(seq.audioTracks);

    var selectionResult = ppb_invertSelectionCollectSelection(seq);

    var result = {
      sequenceName: seq.name,
      skippedUnreadable: skipped
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
