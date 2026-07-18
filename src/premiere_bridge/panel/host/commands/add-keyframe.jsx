// Command: add-keyframe → ppb_addKeyframe
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, findComponentProperty, timeValueToSeconds,
// tryTimeForms, ...) are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `add_keyframe` tool (keyframes.ts), addressed here by
// trackType/trackIndex/clipIndex + componentName/propertyName. Per
// PREMIERE_API_NOTES.md: prop.setTimeVarying(true) is REQUIRED before
// addKey()/setValueAtKey() (called here only if not already time-varying —
// wasAlreadyTimeVarying reports which); `seconds` is clip-relative
// (matching add-audio-keyframes' convention) and offset by clip.start to
// sequence time before use. Key-time argument form is disputed across
// builds — tryTimeForms() tries ticksString, then a Time object, then a
// raw seconds number, recording every attempt. Verified via a getKeys()
// COUNT comparison before/after (not an exact-time match) — remove-keyframe
// is the cleanup path if this adds the wrong thing, since undo is
// non-functional on this build.
function ppb_addKeyframe(argsJson) {
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
    if (typeof args.value === "undefined") {
      return JSON.stringify({ ok: false, error: "value is required" });
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

    var wasAlreadyTimeVarying = false;
    try { wasAlreadyTimeVarying = prop.isTimeVarying(); } catch (e) { wasAlreadyTimeVarying = false; }

    var setTimeVaryingError = null;
    if (!wasAlreadyTimeVarying) {
      try {
        prop.setTimeVarying(true);
      } catch (e) {
        setTimeVaryingError = e.toString();
      }
    }

    var keyCountBefore = 0;
    try {
      var keysBefore = prop.getKeys();
      keyCountBefore = keysBefore ? keysBefore.length : 0;
    } catch (e) {
      keyCountBefore = null;
    }

    var sequenceSeconds = clipStartSeconds + args.seconds;
    var value = args.value;

    var addAttempt = tryTimeForms(sequenceSeconds, function (t) {
      prop.addKey(t);
    });

    var setAttempt = null;
    if (addAttempt.success) {
      setAttempt = tryTimeForms(sequenceSeconds, function (t) {
        prop.setValueAtKey(t, value, true);
      });
    }

    var keyCountAfter = 0;
    try {
      var keysAfter = prop.getKeys();
      keyCountAfter = keysAfter ? keysAfter.length : 0;
    } catch (e) {
      keyCountAfter = null;
    }

    var verified = (keyCountBefore !== null && keyCountAfter !== null && keyCountAfter === keyCountBefore + 1);

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
        value: value,
        wasAlreadyTimeVarying: wasAlreadyTimeVarying,
        setTimeVaryingError: setTimeVaryingError,
        addKeyAttempts: addAttempt.attempts,
        setValueAttempts: setAttempt ? setAttempt.attempts : null,
        keyCountBefore: keyCountBefore,
        keyCountAfter: keyCountAfter,
        verified: verified,
        note: "verified is a KEY-COUNT comparison, not an exact-time match — use get-keyframes to confirm the new key's time/value. remove-keyframe is the cleanup path (undo is non-functional on this build)."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
