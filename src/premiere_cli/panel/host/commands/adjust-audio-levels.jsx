// Command: adjust-audio-levels → ppb_adjustAudioLevels
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findVolumeLevelProperty, dbToLinearCalibrated, linearToDbCalibrated, ...)
// are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `adjust_audio_levels` tool (audio.ts) — but note that reference handler
// actually SETS the Level property directly to the raw `level_db` argument
// (an absolute set, same bug as set_clip_volume's reference, and also not
// really "adjust" semantics despite the tool's name). This command instead
// implements true relative-adjustment semantics: read the clip's current
// linear Level, convert it to an estimated dB via the same calibration
// formula as set-clip-volume, add the requested `db` delta, convert back to
// linear, and apply. See set-clip-volume.jsx's header for the calibration-
// uncertainty caveat — it applies here identically, compounded because this
// command both reads AND writes through the same unverified formula.
function ppb_adjustAudioLevels(argsJson) {
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
      return JSON.stringify({ ok: false, error: "db must be a number (a DELTA relative to the clip's current level)" });
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
    if (previousLinear === null) {
      return JSON.stringify({ ok: false, error: "could not read the clip's current Level value" });
    }

    var previousDbEstimate = linearToDbCalibrated(previousLinear);
    if (previousDbEstimate === null) {
      return JSON.stringify({ ok: false, error: "current Level value (" + previousLinear + ") is not a valid positive amplitude — cannot estimate its dB" });
    }

    var requestedDbTotal = previousDbEstimate + args.db;
    var requestedLinear = dbToLinearCalibrated(requestedDbTotal);

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
      requestedDeltaDb: args.db,
      previousValue: previousLinear,
      previousDbEstimate: previousDbEstimate,
      requestedValue: requestedLinear,
      requestedDbTotal: requestedDbTotal,
      newValue: newLinear,
      verified: verified,
      calibrationNote: "Level is LINEAR AMPLITUDE, not dB — this command estimates the clip's " +
        "current dB from its linear value via hetpatel's UNVERIFIED calibration formula " +
        "(linear = 10^((db-15)/20)), adds the requested delta, then converts back. Compounds " +
        "the same calibration uncertainty documented in set-clip-volume.jsx."
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
