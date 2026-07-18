// Command: get-next-edit-point → ppb_getNextEditPoint
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM read only — no QE DOM needed, no need to activate the
// sequence tab. Ported from leancoderkavy's premiere-pro-mcp
// `get_next_edit_point` tool (utility.ts): collects every clip start/end
// boundary across the given track type(s), then finds the nearest one
// strictly before/after the playhead.

var GET_NEXT_EDIT_POINT_EPSILON_SECONDS = 1e-6;

function ppb_getNextEditPoint(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var direction = args.direction || "next";
    if (direction !== "next" && direction !== "previous") {
      return JSON.stringify({ ok: false, error: "direction must be \"next\" or \"previous\"" });
    }
    var trackType = args.trackType || "both";
    if (trackType !== "video" && trackType !== "audio" && trackType !== "both") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\", \"audio\", or \"both\"" });
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

    var playheadSeconds = null;
    try {
      playheadSeconds = timeValueToSeconds(seq.getPlayerPosition());
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read playhead position: " + e.toString() });
    }
    if (playheadSeconds === null) {
      return JSON.stringify({ ok: false, error: "could not read playhead position" });
    }

    var editPoints = [];

    function collectPoints(trackCollection) {
      var numTracks = 0;
      try { numTracks = trackCollection.numTracks; } catch (e) { return; }
      for (var t = 0; t < numTracks; t++) {
        var track = trackCollection[t];
        var numClips = 0;
        try { numClips = track.clips.numItems; } catch (e) { continue; }
        for (var c = 0; c < numClips; c++) {
          var clip = track.clips[c];
          try { editPoints.push(timeValueToSeconds(clip.start)); } catch (e) { /* skip */ }
          try { editPoints.push(timeValueToSeconds(clip.end)); } catch (e) { /* skip */ }
        }
      }
    }

    if (trackType !== "audio") {
      collectPoints(seq.videoTracks);
    }
    if (trackType !== "video") {
      collectPoints(seq.audioTracks);
    }

    editPoints.sort(function (a, b) { return a - b; });
    var unique = [];
    for (var i = 0; i < editPoints.length; i++) {
      if (editPoints[i] === null || typeof editPoints[i] === "undefined") {
        continue;
      }
      if (unique.length === 0 || Math.abs(editPoints[i] - unique[unique.length - 1]) > GET_NEXT_EDIT_POINT_EPSILON_SECONDS) {
        unique.push(editPoints[i]);
      }
    }

    var found = null;
    if (direction === "next") {
      for (var n = 0; n < unique.length; n++) {
        if (unique[n] > playheadSeconds + GET_NEXT_EDIT_POINT_EPSILON_SECONDS) {
          found = unique[n];
          break;
        }
      }
    } else {
      for (var p = unique.length - 1; p >= 0; p--) {
        if (unique[p] < playheadSeconds - GET_NEXT_EDIT_POINT_EPSILON_SECONDS) {
          found = unique[p];
          break;
        }
      }
    }

    if (found === null) {
      return JSON.stringify({
        ok: true,
        result: { sequenceName: seq.name, found: false, direction: direction, playheadSeconds: playheadSeconds }
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        found: true,
        direction: direction,
        editPointSeconds: found,
        playheadSeconds: playheadSeconds
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
