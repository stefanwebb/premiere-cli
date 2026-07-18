// Command: remove-keyframe-range → ppb_removeKeyframeRange
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, findComponentProperty, timeValueToSeconds,
// secondsToTicksString, secondsToTimeObject, ...) are already defined
// there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `remove_keyframe_range` tool (keyframes.ts), addressed here by
// trackType/trackIndex/clipIndex + componentName/propertyName.
// startSeconds/endSeconds are clip-relative, offset by clip.start to
// sequence time. removeKeyRange(t1, t2) takes two time arguments whose
// form is disputed per PREMIERE_API_NOTES.md — tries ticksString, then
// Time objects, then raw seconds numbers for BOTH arguments together (not
// mixed forms), recording every attempt. Verified via a getKeys() COUNT
// drop — this is the cleanup path for add-keyframe/add-audio-keyframes
// mistakes, since undo is non-functional on this build.
function ppb_removeKeyframeRange(argsJson) {
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
    if (typeof args.startSeconds !== "number" || typeof args.endSeconds !== "number") {
      return JSON.stringify({ ok: false, error: "startSeconds and endSeconds must both be numbers (clip-relative)" });
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

    var sequenceStartSeconds = clipStartSeconds + args.startSeconds;
    var sequenceEndSeconds = clipStartSeconds + args.endSeconds;

    var keyCountBefore = 0;
    try {
      var keysBefore = prop.getKeys();
      keyCountBefore = keysBefore ? keysBefore.length : 0;
    } catch (e) {
      keyCountBefore = null;
    }

    // Two-argument sibling of tryTimeForms — both t1/t2 use the SAME form
    // per attempt (not mixed), since removeKeyRange presumably expects
    // matching argument types.
    var removeAttempts = [];
    var removed = false;
    var forms = [
      { label: "ticksString", t1: secondsToTicksString(sequenceStartSeconds), t2: secondsToTicksString(sequenceEndSeconds) },
      { label: "TimeObject", t1: secondsToTimeObject(sequenceStartSeconds), t2: secondsToTimeObject(sequenceEndSeconds) },
      { label: "seconds", t1: sequenceStartSeconds, t2: sequenceEndSeconds }
    ];
    for (var f = 0; f < forms.length; f++) {
      try {
        prop.removeKeyRange(forms[f].t1, forms[f].t2);
        removeAttempts.push({ form: forms[f].label, success: true });
        removed = true;
        break;
      } catch (e2) {
        removeAttempts.push({ form: forms[f].label, success: false, error: e2.toString() });
      }
    }

    var keyCountAfter = 0;
    try {
      var keysAfter = prop.getKeys();
      keyCountAfter = keysAfter ? keysAfter.length : 0;
    } catch (e3) {
      keyCountAfter = null;
    }

    var keysRemoved = (keyCountBefore !== null && keyCountAfter !== null) ? (keyCountBefore - keyCountAfter) : null;
    var verified = (keysRemoved !== null && keysRemoved > 0);

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
        startSeconds: args.startSeconds,
        endSeconds: args.endSeconds,
        sequenceStartSeconds: sequenceStartSeconds,
        sequenceEndSeconds: sequenceEndSeconds,
        removeAttempts: removeAttempts,
        keyCountBefore: keyCountBefore,
        keyCountAfter: keyCountAfter,
        keysRemoved: keysRemoved,
        verified: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
