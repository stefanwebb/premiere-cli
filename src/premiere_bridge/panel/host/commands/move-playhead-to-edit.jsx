// Command: move-playhead-to-edit → ppb_movePlayheadToEdit
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, ...) are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp move_playhead_to_edit tool
// (utility.ts), combining its edit-point-search logic (same one backing
// get-next-edit-point.jsx: collect every clip start/end tick across all
// video/audio tracks, sort, dedupe, pick the nearest one before/after the
// playhead) with move-playhead.jsx's proven seek pattern for the actual
// move (ticksString first, Time-object fallback, recording each attempt).
// Standard DOM only, no QE needed.
//
// MUTATION RULE: verified by reading back seq.getPlayerPosition() after
// the seek and reporting it alongside the edit point that was targeted —
// never trusting the seek call's own (lack of a) return value.

function ppbMovePlayheadToEdit_collectPoints(seq) {
  var points = [];

  function collect(tracks) {
    for (var t = 0; t < tracks.numTracks; t++) {
      for (var c = 0; c < tracks[t].clips.numItems; c++) {
        var clip = tracks[t].clips[c];
        try { points.push(parseFloat(clip.start.ticks)); } catch (e) { /* skip */ }
        try { points.push(parseFloat(clip.end.ticks)); } catch (e) { /* skip */ }
      }
    }
  }

  collect(seq.videoTracks);
  collect(seq.audioTracks);

  points.sort(function (a, b) { return a - b; });

  var unique = [];
  for (var i = 0; i < points.length; i++) {
    if (unique.length === 0 || points[i] !== unique[unique.length - 1]) {
      unique.push(points[i]);
    }
  }
  return unique;
}

function ppb_movePlayheadToEdit(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var direction = args.direction === "previous" ? "previous" : "next";
    if (args.direction !== undefined && args.direction !== null && args.direction !== "next" && args.direction !== "previous") {
      return JSON.stringify({ ok: false, error: "direction must be \"next\" or \"previous\"" });
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

    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
    }

    var posTicks = null;
    try {
      posTicks = parseFloat(seq.getPlayerPosition().ticks);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read the current playhead position: " + e.toString() });
    }

    var editPoints = ppbMovePlayheadToEdit_collectPoints(seq);

    var found = null;
    if (direction === "next") {
      for (var i = 0; i < editPoints.length; i++) {
        if (editPoints[i] > posTicks + 1) {
          found = editPoints[i];
          break;
        }
      }
    } else {
      for (var j = editPoints.length - 1; j >= 0; j--) {
        if (editPoints[j] < posTicks - 1) {
          found = editPoints[j];
          break;
        }
      }
    }

    if (found === null) {
      return JSON.stringify({ ok: false, error: "no " + direction + " edit point found from the current playhead position" });
    }

    var targetSeconds = found / TICKS_PER_SECOND;
    var ticksString = String(Math.round(found));
    var timeObj = null;
    try {
      timeObj = new Time();
      timeObj.seconds = targetSeconds;
    } catch (e) {
      timeObj = null;
    }

    var positionAttempts = [];
    var positionSet = false;
    try {
      seq.setPlayerPosition(ticksString);
      positionAttempts.push({ form: "ticksString", success: true });
      positionSet = true;
    } catch (e) {
      positionAttempts.push({ form: "ticksString", success: false, error: e.toString() });
    }
    if (!positionSet && timeObj !== null) {
      try {
        seq.setPlayerPosition(timeObj);
        positionAttempts.push({ form: "TimeObject", success: true });
        positionSet = true;
      } catch (e) {
        positionAttempts.push({ form: "TimeObject", success: false, error: e.toString() });
      }
    }

    if (!positionSet) {
      return JSON.stringify({
        ok: false,
        error: "could not move the playhead to the found edit point with any known argument form (ticks string, Time object)",
        attempts: positionAttempts
      });
    }

    var playheadSeconds = null;
    try {
      var currentPosition = seq.getPlayerPosition();
      if (currentPosition !== null && typeof currentPosition !== "undefined") {
        if (typeof currentPosition.seconds === "number") {
          playheadSeconds = currentPosition.seconds;
        } else {
          playheadSeconds = Number(currentPosition.ticks) / TICKS_PER_SECOND;
        }
      }
    } catch (e) {
      playheadSeconds = null;
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        direction: direction,
        editPointSeconds: targetSeconds,
        playheadSeconds: playheadSeconds,
        attempts: positionAttempts
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
