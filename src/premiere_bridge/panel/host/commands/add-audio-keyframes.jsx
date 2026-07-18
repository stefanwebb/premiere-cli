// Command: add-audio-keyframes → ppb_addAudioKeyframes
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findVolumeLevelProperty, timeValueToSeconds, TICKS_PER_SECOND, ...) are
// already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `add_audio_keyframes` tool (audio.ts). Per PREMIERE_API_NOTES.md:
// prop.setTimeVarying(true) is REQUIRED before addKey()/setValueAtKey(),
// and keyframe times are in SEQUENCE time (not clip-relative) — so each
// `seconds` value (documented as clip-relative, matching the reference's
// own "time_seconds ... relative to clip start" description) is offset by
// the clip's own start time before being converted to ticks.
//
// dB->linear conversion uses the SAME hetpatel-calibrated formula as
// set-clip-volume/adjust-audio-levels (linear = 10^((dB-15)/20)) so dB
// values are interchangeable across all three audio commands. Unified at
// integration 2026-07-17 — the reference tool's own code used a raw
// 10^(db/20), which disagreed with its sibling volume tools. The
// calibration itself is still UNVERIFIED against this Premiere build.
function ppb_addAudioKeyframes(argsJson) {
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

    var keyframes;
    if (typeof args.keyframes === "string") {
      try {
        keyframes = JSON.parse(args.keyframes);
      } catch (e) {
        return JSON.stringify({ ok: false, error: "keyframes could not be parsed as JSON: " + e.toString() });
      }
    } else {
      return JSON.stringify({ ok: false, error: "keyframes must be a JSON string of [{seconds, db}, ...]" });
    }
    if (!(keyframes && typeof keyframes.length === "number")) {
      return JSON.stringify({ ok: false, error: "keyframes must decode to a JSON array" });
    }
    if (keyframes.length === 0) {
      return JSON.stringify({ ok: false, error: "keyframes array is empty — at least one keyframe is required" });
    }
    for (var v = 0; v < keyframes.length; v++) {
      var kf = keyframes[v];
      if (!kf || typeof kf.seconds !== "number" || typeof kf.db !== "number") {
        return JSON.stringify({ ok: false, error: "keyframes[" + v + "] must be {seconds: number, db: number}" });
      }
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

    var clipStartSeconds = 0;
    try { clipStartSeconds = timeValueToSeconds(clip.start) || 0; } catch (e) { clipStartSeconds = 0; }

    var levelProp = findVolumeLevelProperty(clip);
    if (!levelProp) {
      return JSON.stringify({ ok: false, error: "could not find Volume/Level property on clip — is this an audio clip?" });
    }

    var setTimeVaryingError = null;
    try {
      levelProp.setTimeVarying(true);
    } catch (e) {
      setTimeVaryingError = e.toString();
    }

    var results = [];
    var succeeded = 0;
    for (var i = 0; i < keyframes.length; i++) {
      var seconds = keyframes[i].seconds;
      var db = keyframes[i].db;
      var linear = Math.pow(10, (db - 15) / 20);
      if (linear < 0.0000001) {
        linear = 0.0000001;
      }
      var sequenceSeconds = clipStartSeconds + seconds;
      var ticksString = String(Math.round(sequenceSeconds * TICKS_PER_SECOND));

      var entry = { seconds: seconds, db: db, linear: linear, sequenceSeconds: sequenceSeconds, addKeySuccess: false, setValueSuccess: false };

      try {
        levelProp.addKey(ticksString);
        entry.addKeySuccess = true;
      } catch (e1) {
        entry.addKeyError = e1.toString();
      }

      try {
        levelProp.setValueAtKey(ticksString, linear, true);
        entry.setValueSuccess = true;
      } catch (e2) {
        try {
          levelProp.setValueAtTime(ticksString, linear);
          entry.setValueSuccess = true;
          entry.setValueMethod = "setValueAtTime";
        } catch (e3) {
          entry.setValueError = e2.toString() + " / " + e3.toString();
        }
      }

      if (entry.addKeySuccess && entry.setValueSuccess) {
        succeeded++;
      }
      results.push(entry);
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName,
      setTimeVaryingError: setTimeVaryingError,
      keyframesRequested: keyframes.length,
      keyframesSucceeded: succeeded,
      keyframes: results,
      calibrationNote: "dB->linear uses the reference tool's own UNCALIBRATED formula " +
        "(10^(db/20), floored at 1e-7) — a DIFFERENT formula from set-clip-volume.jsx's " +
        "hetpatel-calibrated one. Neither has been verified against this Premiere build."
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
