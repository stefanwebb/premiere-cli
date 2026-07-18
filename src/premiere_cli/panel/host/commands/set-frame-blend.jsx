// Command: set-frame-blend → ppb_setFrameBlend
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, qeFindNthNonEmptyClip, ...) are
// already defined there.
//
// QE DOM mutation — `qeClip.setFrameBlend(bool)` per PREMIERE_API_NOTES.md
// ("Interp/blend" line) and leancoderkavy's `set_frame_blend` tool
// (advanced.ts). QE only ever operates on the active sequence, so the
// resolved sequence is activated first (same as get-qe-clip-info). The
// addressed clip's standard-DOM trackType/trackIndex/clipIndex is resolved
// to the corresponding QE clip via qeFindNthNonEmptyClip — QE track item
// lists interleave "Empty" gap items between real clips, so the Nth
// standard-DOM clip is the Nth NON-Empty QE item, not simply
// qeTrack.getItemAt(clipIndex). There is no standard-DOM read for frame
// blend state, so "previousValue" here is unavailable — undo is
// non-functional on this build per the README, so this is the only
// pre-mutation signal a caller gets; verification instead re-reads via
// `qeClip.frameBlend` if that property exists post-mutation (best-effort,
// not guaranteed present on this build).
function ppb_setFrameBlend(argsJson) {
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
    if (typeof args.enabled !== "boolean") {
      return JSON.stringify({ ok: false, error: "enabled must be a boolean" });
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

    var previousValue = null;
    try { previousValue = qeClip.frameBlend; } catch (e) { previousValue = null; }

    try {
      qeClip.setFrameBlend(args.enabled);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qeClip.setFrameBlend() failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = qeClip.frameBlend; } catch (e) { newValue = null; }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: standardClipName,
      requestedValue: args.enabled,
      previousValue: previousValue,
      newValue: newValue,
      verified: newValue === args.enabled
    };
    if (newValue === null) {
      result.note = "qeClip.frameBlend was not readable on this build — setFrameBlend() did not throw, but the result is unverified (see README's undo caveat: read-back is the only confirmation available here).";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
