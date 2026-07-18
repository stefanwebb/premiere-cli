// Command: set-keyframe-interpolation → ppb_setKeyframeInterpolation
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, findComponentProperty, timeValueToSeconds,
// keyTimeToSeconds, tryTimeForms, getSequenceFps, ...) are already defined
// there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `set_keyframe_interpolation` tool (keyframes.ts), addressed here by
// trackType/trackIndex/clipIndex + componentName/propertyName. `seconds`
// is clip-relative, offset by clip.start to sequence time (same half-frame
// tolerance existing-key lookup as remove-keyframe).
//
// interpolationType IS A RAW INT, and its enum meaning is DISPUTED across
// Premiere builds per PREMIERE_API_NOTES.md's Property API block:
// leancoderkavy uses 0=Linear, 4=Hold, 5=Bezier; ayushozha's own docs claim
// a plain 0/1/2 map instead. This command does NOT translate a name to an
// int — the caller passes the raw int and gets it back unmodified; treat
// the actual on-screen result as the source of truth until verified live.
// There is no confirmed getter to read a keyframe's current interpolation
// back — `verified` here only means the setInterpolationTypeAtKey() call
// itself did not throw, NOT that Premiere applied the requested type.
function ppb_setKeyframeInterpolation(argsJson) {
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
    if (typeof args.componentName !== "string" || !args.componentName) {
      return JSON.stringify({ ok: false, error: "componentName is required" });
    }
    if (typeof args.propertyName !== "string" || !args.propertyName) {
      return JSON.stringify({ ok: false, error: "propertyName is required" });
    }
    if (typeof args.seconds !== "number") {
      return JSON.stringify({ ok: false, error: "seconds must be a number (clip-relative)" });
    }
    if (typeof args.interpolationType !== "number" || Math.floor(args.interpolationType) !== args.interpolationType) {
      return JSON.stringify({ ok: false, error: "interpolationType must be an integer (meaning is version-dependent — see docs)" });
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

    var comp = findClipComponent(clip, [args.componentName], [args.componentName]);
    if (!comp) {
      return JSON.stringify({
        ok: false,
        error: "component \"" + args.componentName + "\" not found on clip (matched against matchName and displayName)"
      });
    }
    var compDisplayName = null;
    try { compDisplayName = comp.displayName; } catch (e) { compDisplayName = null; }

    var prop = findComponentProperty(comp, [args.propertyName]);
    if (!prop) {
      return JSON.stringify({
        ok: false,
        error: "property \"" + args.propertyName + "\" not found on component \"" + compDisplayName + "\""
      });
    }

    var fps = 30;
    try { fps = getSequenceFps(seq) || 30; } catch (e) { fps = 30; }
    var toleranceSeconds = 0.5 / fps;

    var sequenceSeconds = clipStartSeconds + args.seconds;

    var rawKeys = null;
    try { rawKeys = prop.getKeys(); } catch (e) { rawKeys = null; }

    var matchedKey = null;
    var matchedSeconds = null;
    if (rawKeys) {
      for (var i = 0; i < rawKeys.length; i++) {
        var ks = null;
        try { ks = keyTimeToSeconds(rawKeys[i]); } catch (e1) { ks = null; }
        if (ks !== null && Math.abs(ks - sequenceSeconds) <= toleranceSeconds) {
          matchedKey = rawKeys[i];
          matchedSeconds = ks;
          break;
        }
      }
    }

    var interpolationType = args.interpolationType;
    var setAttempts = [];
    var set = false;

    if (matchedKey !== null) {
      try {
        prop.setInterpolationTypeAtKey(matchedKey, interpolationType, true);
        setAttempts.push({ form: "existingKeyObject", success: true });
        set = true;
      } catch (e2) {
        setAttempts.push({ form: "existingKeyObject", success: false, error: e2.toString() });
      }
    }

    if (!set) {
      var tf = tryTimeForms(sequenceSeconds, function (t) {
        prop.setInterpolationTypeAtKey(t, interpolationType, true);
      });
      setAttempts = setAttempts.concat(tf.attempts);
      set = tf.success;
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: clipName,
        componentName: compDisplayName,
        propertyName: args.propertyName,
        seconds: args.seconds,
        sequenceSeconds: sequenceSeconds,
        toleranceSeconds: toleranceSeconds,
        matchedExistingKey: matchedKey !== null,
        matchedSeconds: matchedSeconds,
        interpolationType: interpolationType,
        setAttempts: setAttempts,
        called: set,
        note: "interpolationType is a RAW INT whose enum meaning is DISPUTED across Premiere builds " +
          "(0=Linear/4=Hold/5=Bezier per one reference repo vs. a plain 0/1/2 map per another) — " +
          "no name-mapping is applied here. `called` only confirms the call didn't throw; there is " +
          "no confirmed getter to read a keyframe's interpolation back and verify the result."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
