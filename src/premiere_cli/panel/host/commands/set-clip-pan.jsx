// Command: set-clip-pan → ppb_setClipPan
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findPannerProperty, ...) are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `set_clip_pan` tool (track-targeting.ts) — Panner component's
// Balance/Pan property, -100 (full left) .. 100 (full right), 0 = center,
// same range as the reference. No dB-style conversion involved, unlike
// set-clip-volume.
function ppb_setClipPan(argsJson) {
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
    if (typeof args.pan !== "number" || isNaN(args.pan) || args.pan < -100 || args.pan > 100) {
      return JSON.stringify({ ok: false, error: "pan must be a number between -100 and 100" });
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

    var track = trackCollection[args.trackIndex];
    var numClips = track.clips.numItems;
    if (args.clipIndex >= numClips) {
      return JSON.stringify({
        ok: false,
        error: "clipIndex " + args.clipIndex + " is out of range — track " + args.trackIndex + " has " + numClips + " clip(s)"
      });
    }

    var clip = track.clips[args.clipIndex];
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var panProp = findPannerProperty(clip);
    if (!panProp) {
      return JSON.stringify({ ok: false, error: "could not find Panner Balance/Pan property on clip — is this an audio clip?" });
    }

    var previousValue = null;
    try { previousValue = panProp.getValue(); } catch (e) { previousValue = null; }

    try {
      panProp.setValue(args.pan, true);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "panProp.setValue() failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = panProp.getValue(); } catch (e) { newValue = null; }

    var verified = newValue !== null && Math.abs(newValue - args.pan) < 0.001;

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName,
      requestedValue: args.pan,
      previousValue: previousValue,
      newValue: newValue,
      verified: verified
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
