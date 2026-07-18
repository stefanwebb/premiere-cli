// Command: set-time-interpolation → ppb_setTimeInterpolation
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, qeFindNthNonEmptyClip, ...) are
// already defined there.
//
// QE DOM mutation — `qeClip.setTimeInterpolationType(0|1|2)` per
// PREMIERE_API_NOTES.md ("Interp/blend" line: 0=sampling, 1=blending,
// 2=optical flow) and leancoderkavy's `set_time_interpolation` tool
// (advanced.ts). Same QE clip-addressing care as set-frame-blend: the
// resolved sequence is activated first, and the standard-DOM clipIndex is
// mapped to the Nth non-"Empty" QE item via qeFindNthNonEmptyClip (QE
// track item lists interleave gap items the standard DOM doesn't expose).
function ppb_setTimeInterpolation(argsJson) {
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
    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.clipIndex !== "number" || args.clipIndex < 0 || Math.floor(args.clipIndex) !== args.clipIndex) {
      return JSON.stringify({ ok: false, error: "clipIndex must be a non-negative integer" });
    }
    if (args.type !== 0 && args.type !== 1 && args.type !== 2) {
      return JSON.stringify({ ok: false, error: "type must be 0 (sampling), 1 (blending), or 2 (optical flow)" });
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

    var trackCollection = args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var numTracks = trackCollection.numTracks;
    if (args.trackIndex >= numTracks) {
      return JSON.stringify({
        ok: false,
        error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " " + args.trackType + " track(s)"
      });
    }
    var numClips = trackCollection[args.trackIndex].clips.numItems;
    if (args.clipIndex >= numClips) {
      return JSON.stringify({
        ok: false,
        error: "clipIndex " + args.clipIndex + " is out of range — track " + args.trackIndex + " has " + numClips + " clip(s)"
      });
    }
    var standardClipName = null;
    try { standardClipName = trackCollection[args.trackIndex].clips[args.clipIndex].name; } catch (e) { standardClipName = null; }

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var qeSeq;
    try {
      qeSeq = qe.project.getActiveSequence();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() failed: " + e.toString() });
    }
    var qeTrack;
    try {
      qeTrack = args.trackType === "video" ? qeSeq.getVideoTrackAt(args.trackIndex) : qeSeq.getAudioTrackAt(args.trackIndex);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "QE track lookup failed: " + e.toString() });
    }
    if (!qeTrack) {
      return JSON.stringify({ ok: false, error: "QE track not found at index " + args.trackIndex });
    }

    var qeClip;
    try {
      qeClip = qeFindNthNonEmptyClip(qeTrack, args.clipIndex);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "QE clip lookup failed: " + e.toString() });
    }
    if (!qeClip) {
      return JSON.stringify({ ok: false, error: "could not locate the corresponding non-Empty QE clip at clipIndex " + args.clipIndex });
    }

    var typeNames = ["sampling", "blending", "optical-flow"];

    var previousValue = null;
    try { previousValue = qeClip.timeInterpolationType; } catch (e) { previousValue = null; }

    try {
      qeClip.setTimeInterpolationType(args.type);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qeClip.setTimeInterpolationType() failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = qeClip.timeInterpolationType; } catch (e) { newValue = null; }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: standardClipName,
      requestedValue: args.type,
      requestedValueName: typeNames[args.type],
      previousValue: previousValue,
      newValue: newValue,
      verified: newValue === args.type
    };
    if (newValue === null) {
      result.note = "qeClip.timeInterpolationType was not readable on this build — setTimeInterpolationType() did not throw, but the result is unverified.";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
