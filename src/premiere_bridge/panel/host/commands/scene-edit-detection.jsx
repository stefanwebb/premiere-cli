// Command: scene-edit-detection → ppb_sceneEditDetection
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's advanced.ts
// scene_edit_detection tool, expanded per PREMIERE_API_NOTES.md's fuller
// signature: `seq.performSceneEditDetectionOnSelection(mode, applyToLinked
// AudioBool, sensitivity)` where mode is "ApplyCuts"|"CreateMarkers" and
// sensitivity is "Low"|"Medium"|"High" (the reference tool's own handler
// calls the zero-arg form, dropping all three).
//
// ⚠️ OPERATES ON THE CURRENT SELECTION, not the whole sequence — same
// selection precondition as nest-clips.jsx. This command refuses outright
// if nothing is selected rather than letting Premiere silently no-op, and
// reports selectedClipCount so callers know what was actually processed.
// Marker counts are read before/after only for "CreateMarkers" mode;
// "ApplyCuts" mode's razor-cut effect is not independently verified here
// (scene detection can run asynchronously, same caveat as
// stabilize-clip.jsx's Warp Stabilizer analysis).
function ppb_sceneEditDetection(argsJson) {
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

    var validModes = { ApplyCuts: true, CreateMarkers: true };
    if (!args.mode || !validModes[args.mode]) {
      return JSON.stringify({ ok: false, error: "mode must be one of ApplyCuts, CreateMarkers" });
    }
    if (typeof args.applyToLinkedAudio !== "boolean") {
      return JSON.stringify({ ok: false, error: "applyToLinkedAudio (boolean) is required" });
    }
    var validSensitivities = { Low: true, Medium: true, High: true };
    if (!args.sensitivity || !validSensitivities[args.sensitivity]) {
      return JSON.stringify({ ok: false, error: "sensitivity must be one of Low, Medium, High" });
    }

    var seq;
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
    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
    }

    var selectedCount = 0;
    function countSelected(tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        for (var c = 0; c < tracks[t].clips.numItems; c++) {
          var isSel = false;
          try { isSel = tracks[t].clips[c].isSelected(); } catch (e) { isSel = false; }
          if (isSel) {
            selectedCount++;
          }
        }
      }
    }
    countSelected(seq.videoTracks);
    countSelected(seq.audioTracks);

    if (selectedCount === 0) {
      return JSON.stringify({
        ok: false,
        error: "no clips selected — this operation runs on the current SELECTION (select clips first, e.g. select-clips-by-name/select-all-clips)"
      });
    }

    function countMarkers() {
      var n = 0;
      var m = seq.markers.getFirstMarker();
      while (m) {
        n++;
        m = seq.markers.getNextMarker(m);
      }
      return n;
    }

    var markerCountBefore = null;
    try { markerCountBefore = countMarkers(); } catch (e) { markerCountBefore = null; }

    try {
      seq.performSceneEditDetectionOnSelection(args.mode, args.applyToLinkedAudio, args.sensitivity);
    } catch (e) {
      return JSON.stringify({
        ok: false,
        error: "seq.performSceneEditDetectionOnSelection() failed: " + e.toString(),
        selectedClipCount: selectedCount
      });
    }

    var markerCountAfter = null;
    if (args.mode === "CreateMarkers") {
      try { markerCountAfter = countMarkers(); } catch (e) { markerCountAfter = null; }
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        mode: args.mode,
        applyToLinkedAudio: args.applyToLinkedAudio,
        sensitivity: args.sensitivity,
        selectedClipCount: selectedCount,
        markerCountBefore: markerCountBefore,
        markerCountAfter: markerCountAfter,
        note: "operates on the current SELECTION, not the whole sequence. ApplyCuts mode's razor-cut effect is not independently verified here (scene detection may run asynchronously); markerCountAfter is only populated for CreateMarkers mode."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
