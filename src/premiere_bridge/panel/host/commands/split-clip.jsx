
// seconds -> "HH:MM:SS:FF" — the razor argument form PROVEN working on
// this build (remove-track-intervals live-validated it); the ticksString
// form silently no-ops (live-tested 2026-07-17).
function ppbSplitClip_secondsToQeTimecode(seconds, fps) {
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
// Command: split-clip → ppb_splitClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, secondsToTicksString, ...) are
// already defined there.
//
// Splits (razors) whichever clip covers a given SEQUENCE-TIME position on
// one track, via the QE DOM's qeTrack.razor(ticksString) —
// PREMIERE_API_NOTES.md: "Split/razor: QE only ... Standard-DOM
// 'fallback' (truncating clip.end) is destructive — don't." Addressed by
// trackType/trackIndex only (not clipIndex) since a razor cut targets a
// TIME, not a specific clip index — matches leancoderkavy's
// premiere-pro-mcp split_clip tool. Activates the resolved sequence
// first (QE DOM only ever operates on the active sequence tab), same
// pattern as remove-track-intervals/get-qe-clip-info.
//
// MUTATION RULE: verified via the STANDARD-DOM track's clips.numItems
// increasing by exactly one (never razor()'s own return value).

function ppb_splitClip(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.trackType !== "video" && args.trackType !== "audio") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" or \"audio\"" });
    }
    if (typeof args.trackIndex !== "number") {
      return JSON.stringify({ ok: false, error: "trackIndex is required" });
    }
    if (typeof args.seconds !== "number") {
      return JSON.stringify({ ok: false, error: "seconds is required" });
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

    var stdTrackCollection = args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var numStdTracks;
    try { numStdTracks = stdTrackCollection.numTracks; } catch (e2) { numStdTracks = 0; }
    if (args.trackIndex >= numStdTracks) {
      return JSON.stringify({ ok: false, error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numStdTracks + " " + args.trackType + " track(s)" });
    }
    var stdTrack = stdTrackCollection[args.trackIndex];
    var clipCountBefore = null;
    try { clipCountBefore = stdTrack.clips.numItems; } catch (e3) { clipCountBefore = null; }

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e4) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e4.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var qeSeq;
    try {
      qeSeq = qe.project.getActiveSequence();
    } catch (e5) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() failed: " + e5.toString() });
    }
    if (!qeSeq) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() returned nothing after activating the sequence" });
    }

    var qeTrack;
    try {
      qeTrack = args.trackType === "video" ? qeSeq.getVideoTrackAt(args.trackIndex) : qeSeq.getAudioTrackAt(args.trackIndex);
    } catch (e6) {
      return JSON.stringify({ ok: false, error: "QE track lookup failed: " + e6.toString() });
    }
    if (!qeTrack) {
      return JSON.stringify({ ok: false, error: "QE track not found at index " + args.trackIndex });
    }

    var ticksString = secondsToTicksString(args.seconds);
    try {
      var fps2 = getSequenceFps(seq);
      var qeTimecode2 = ppbSplitClip_secondsToQeTimecode(args.seconds, fps2);
      try {
        qeTrack.razor(qeTimecode2);
      } catch (eTc) {
        qeTrack.razor(ticksString);
      }
    } catch (e7) {
      return JSON.stringify({ ok: false, error: "qeTrack.razor() failed: " + e7.toString() });
    }

    var clipCountAfter = null;
    try { clipCountAfter = stdTrack.clips.numItems; } catch (e8) { clipCountAfter = null; }

    var verified = clipCountBefore !== null && clipCountAfter !== null && clipCountAfter === clipCountBefore + 1;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        seconds: args.seconds,
        clipCountBefore: clipCountBefore,
        clipCountAfter: clipCountAfter,
        verified: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
