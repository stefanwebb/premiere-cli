// Command: set-clip-volume → ppb_setClipVolume
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findVolumeLevelProperty, dbToLinearCalibrated, linearToDbCalibrated, ...)
// are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `set_clip_volume` tool (track-targeting.ts), which sets the Volume
// component's Level property directly to the raw dB number passed in —
// but PREMIERE_API_NOTES.md is explicit that Level is LINEAR AMPLITUDE, not
// dB, so setValue(dB) as the reference does is almost certainly wrong on
// any real build. This command instead converts the requested dB to
// linear amplitude via hetpatel's empirical calibration for this build
// family (linear = 10^((dB-15)/20)) before calling setValue().
//
// *** CALIBRATION UNCERTAINTY — READ BEFORE TRUSTING THIS COMMAND ***
// The three reference MCP repos studied for this port do NOT agree on the
// dB->linear formula: hetpatel's calibrated 10^((dB-15)/20) (used here),
// leancoderkavy's uncalibrated 10^(dB/20), and ayushozha's "mostly raw dB,
// docs admit it's linear". None of this has been live-verified against
// THIS Premiere build — do that before relying on the resulting level
// sounding correct. Both the raw linear values (previous/requested/new)
// AND the requested dB are returned so a caller can sanity-check/recalibrate
// without re-running the mutation.
function ppb_setClipVolume(argsJson) {
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
    if (typeof args.db !== "number" || isNaN(args.db)) {
      return JSON.stringify({ ok: false, error: "db must be a number" });
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

    var levelProp = findVolumeLevelProperty(clip);
    if (!levelProp) {
      return JSON.stringify({ ok: false, error: "could not find Volume/Level property on clip — is this an audio clip?" });
    }

    var previousLinear = null;
    try { previousLinear = levelProp.getValue(); } catch (e) { previousLinear = null; }

    var requestedLinear = dbToLinearCalibrated(args.db);

    try {
      levelProp.setValue(requestedLinear, true);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "levelProp.setValue() failed: " + e.toString() });
    }

    var newLinear = null;
    try { newLinear = levelProp.getValue(); } catch (e) { newLinear = null; }

    var verified = newLinear !== null && Math.abs(newLinear - requestedLinear) < 0.0005;

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName,
      requestedDb: args.db,
      previousValue: previousLinear,
      requestedValue: requestedLinear,
      newValue: newLinear,
      verified: verified,
      previousDbEstimate: linearToDbCalibrated(previousLinear),
      calibrationNote: "Level is LINEAR AMPLITUDE, not dB. Converted via hetpatel's empirical " +
        "calibration linear = 10^((db-15)/20) — UNVERIFIED against this Premiere build; " +
        "other reference repos use different formulas (see file header comment)."
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
