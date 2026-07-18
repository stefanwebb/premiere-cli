// Command: select-clips-by-name → ppb_selectClipsByName
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM only (clip.setSelected(bool, true)) — no QE needed. Ported
// from leancoderkavy's premiere-pro-mcp `select_clips_by_name` tool
// (selection.ts): case-insensitive substring match against clip name,
// across all video+audio tracks. Mutation — verified via seq.getSelection()
// afterward, never via setSelected()'s own return value.

function ppb_selectClipsByNameCollectSelection(seq) {
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

function ppb_selectClipsByName(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.nameContains || typeof args.nameContains !== "string") {
      return JSON.stringify({ ok: false, error: "nameContains is required" });
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

    var addToSelection = !!args.addToSelection;
    var query = args.nameContains.toLowerCase();

    function deselectAll() {
      var t, c;
      for (t = 0; t < seq.videoTracks.numTracks; t++) {
        var vt = seq.videoTracks[t];
        for (c = 0; c < vt.clips.numItems; c++) {
          try { vt.clips[c].setSelected(false, true); } catch (e) { /* best-effort */ }
        }
      }
      for (t = 0; t < seq.audioTracks.numTracks; t++) {
        var at = seq.audioTracks[t];
        for (c = 0; c < at.clips.numItems; c++) {
          try { at.clips[c].setSelected(false, true); } catch (e) { /* best-effort */ }
        }
      }
    }

    if (!addToSelection) {
      deselectAll();
    }

    function selectMatchingInTracks(tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
          var clip = track.clips[c];
          var clipName = null;
          try { clipName = clip.name; } catch (e) { clipName = null; }
          if (clipName !== null && clipName.toLowerCase().indexOf(query) !== -1) {
            try { clip.setSelected(true, true); } catch (e) { /* best-effort */ }
          }
        }
      }
    }

    selectMatchingInTracks(seq.videoTracks);
    selectMatchingInTracks(seq.audioTracks);

    var selectionResult = ppb_selectClipsByNameCollectSelection(seq);

    var result = {
      sequenceName: seq.name,
      nameContains: args.nameContains,
      addToSelection: addToSelection
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
