
// seconds -> "HH:MM:SS:FF" — the razor argument form PROVEN working on
// this build (remove-track-intervals live-validated it); the ticksString
// form silently no-ops (live-tested 2026-07-17).
function ppbRazorAll_secondsToQeTimecode(seconds, fps) {
  var totalFrames = Math.round(seconds * fps);
  var ff = totalFrames % Math.round(fps);
  var totalSeconds = Math.floor(totalFrames / Math.round(fps));
  var ss = totalSeconds % 60;
  var totalMinutes = Math.floor(totalSeconds / 60);
  var mm = totalMinutes % 60;
  var hh = Math.floor(totalMinutes / 60);
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  return pad2(hh) + ":" + pad2(mm) + ":" + pad2(ss) + ":" + pad2(ff);
}
// Command: razor-all-tracks → ppb_razorAllTracks
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, TICKS_PER_SECOND, activateSequenceForQE, ...) are
// already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's track-targeting.ts
// razor_all_tracks. Razors (splits) every video+audio track at a given
// time (defaults to the sequence's own playhead if `seconds` is omitted)
// via QE `track.razor(ticksString)` — same razor mechanism as
// remove-track-intervals, but applied to every track instead of one.
// Destructive-ish: a razor cut cannot be undone (undo is non-functional on
// this build per README.md), and callers should not run this against real
// footage without first duplicating the sequence.
//
// Verification: per-track clip-item-COUNT before/after (via the QE
// track's numItems) rather than trusting razor()'s own return value —
// same "never trust the call's return value" rule as every other QE
// command in this panel.
function ppb_razorAllTracks(argsJson) {
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

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() returned nothing after activating the sequence" });
    }

    var atSeconds;
    if (typeof args.seconds === "number" && !isNaN(args.seconds)) {
      atSeconds = args.seconds;
    } else {
      try {
        atSeconds = seq.getPlayerPosition().seconds;
      } catch (e) {
        return JSON.stringify({ ok: false, error: "seconds was omitted and the playhead position could not be read: " + e.toString() });
      }
    }
    var ticksString = String(Math.round(atSeconds * TICKS_PER_SECOND));
    var fps = getSequenceFps(seq);
    var qeTimecode = ppbRazorAll_secondsToQeTimecode(args.seconds, fps);

    var perTrack = [];
    var totalRazored = 0;

    var numVideoTracks = 0;
    try { numVideoTracks = qeSeq.numVideoTracks; } catch (e) { numVideoTracks = 0; }
    for (var v = 0; v < numVideoTracks; v++) {
      var vTrack = null;
      try { vTrack = qeSeq.getVideoTrackAt(v); } catch (e) { vTrack = null; }
      if (!vTrack) {
        perTrack.push({ trackType: "video", trackIndex: v, error: "QE track lookup failed" });
        continue;
      }
      var vBefore = null;
      try { vBefore = vTrack.numItems; } catch (e) { vBefore = null; }
      var vRazorError = null;
      try {
        vTrack.razor(qeTimecode);
      } catch (e) {
        vRazorError = e.toString();
      }
      var vAfter = null;
      try { vAfter = vTrack.numItems; } catch (e) { vAfter = null; }
      var vChanged = vBefore !== null && vAfter !== null && vAfter > vBefore;
      if (vChanged) {
        totalRazored++;
      }
      perTrack.push({
        trackType: "video",
        trackIndex: v,
        itemCountBefore: vBefore,
        itemCountAfter: vAfter,
        razored: vChanged,
        error: vRazorError
      });
    }

    var numAudioTracks = 0;
    try { numAudioTracks = qeSeq.numAudioTracks; } catch (e) { numAudioTracks = 0; }
    for (var a = 0; a < numAudioTracks; a++) {
      var aTrack = null;
      try { aTrack = qeSeq.getAudioTrackAt(a); } catch (e) { aTrack = null; }
      if (!aTrack) {
        perTrack.push({ trackType: "audio", trackIndex: a, error: "QE track lookup failed" });
        continue;
      }
      var aBefore = null;
      try { aBefore = aTrack.numItems; } catch (e) { aBefore = null; }
      var aRazorError = null;
      try {
        aTrack.razor(qeTimecode);
      } catch (e) {
        aRazorError = e.toString();
      }
      var aAfter = null;
      try { aAfter = aTrack.numItems; } catch (e) { aAfter = null; }
      var aChanged = aBefore !== null && aAfter !== null && aAfter > aBefore;
      if (aChanged) {
        totalRazored++;
      }
      perTrack.push({
        trackType: "audio",
        trackIndex: a,
        itemCountBefore: aBefore,
        itemCountAfter: aAfter,
        razored: aChanged,
        error: aRazorError
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        atSeconds: atSeconds,
        tracksAttempted: perTrack.length,
        tracksRazored: totalRazored,
        tracks: perTrack
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
