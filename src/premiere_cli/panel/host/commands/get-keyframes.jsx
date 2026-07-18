// Command: get-keyframes → ppb_getKeyframes
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, findComponentProperty, timeValueToSeconds,
// keyTimeToSeconds, getSequenceFps, ...) are already defined there.
//
// Standard-DOM only — no QE needed. Ported from leancoderkavy's
// premiere-pro-mcp `get_keyframes` tool (keyframes.ts), addressed here by
// trackType/trackIndex/clipIndex + componentName/propertyName. READ-only.
//
// Per PREMIERE_API_NOTES.md, prop.getKeys() key times are DISPUTED across
// Premiere builds/repos (Time objects vs. raw ticks vs. raw seconds) —
// keyTimeToSeconds() normalizes defensively (see its own comment for the
// heuristic). Each key is reported as BOTH sequenceSeconds (raw Premiere
// time) AND clipRelativeSeconds (offset by the clip's own start, matching
// how add-audio-keyframes/add-keyframe accept clip-relative input).
function ppb_getKeyframes(argsJson) {
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

    var isTimeVarying = false;
    try { isTimeVarying = prop.isTimeVarying(); } catch (e) { isTimeVarying = false; }

    if (!isTimeVarying) {
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
          isTimeVarying: false,
          keyCount: 0,
          keys: []
        }
      });
    }

    var rawKeys = null;
    try { rawKeys = prop.getKeys(); } catch (e) { rawKeys = null; }

    var keys = [];
    if (rawKeys) {
      for (var i = 0; i < rawKeys.length; i++) {
        var rawKey = rawKeys[i];
        var entry = { sequenceSeconds: null, clipRelativeSeconds: null, value: null };
        try { entry.sequenceSeconds = keyTimeToSeconds(rawKey); } catch (e1) { entry.sequenceSeconds = null; }
        if (entry.sequenceSeconds !== null) {
          entry.clipRelativeSeconds = entry.sequenceSeconds - clipStartSeconds;
        }
        try { entry.value = prop.getValueAtKey(rawKey); } catch (e2) { entry.value = null; }
        keys.push(entry);
      }
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
        isTimeVarying: true,
        keyCount: keys.length,
        keys: keys
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
