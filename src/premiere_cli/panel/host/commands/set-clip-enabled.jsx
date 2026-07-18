// Command: set-clip-enabled → ppb_setClipEnabled
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `enable_disable_clip` tool (timeline.ts) — renamed here to
// `set-clip-enabled` for explicitness (the reference name reads as a
// verb pair, this one states the positive-sense boolean it takes). Args
// use `enabled` (true = clip plays, false = clip disabled) — the
// underlying Premiere property is the INVERTED `clip.disabled` /
// `clip.setDisabled()`, so this command negates at the boundary. Per
// PREMIERE_API_NOTES.md, `clip.disabled = bool` [hetpatel] and
// `clip.setDisabled(bool)` [leancoderkavy] are both cited as existing —
// probed in that order, whichever sticks (verified via a clip.disabled
// read-back) determines `method`.
function ppb_setClipEnabled(argsJson) {
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

    var previousValue = null;
    try { previousValue = clip.disabled; } catch (e) { previousValue = null; }

    var requestedDisabled = !args.enabled;
    var method = null;
    var assignError = null;
    var setDisabledError = null;

    try {
      clip.disabled = requestedDisabled;
      method = "disabledAssignment";
    } catch (e) {
      assignError = e.toString();
    }

    var newValue = null;
    try { newValue = clip.disabled; } catch (e) { newValue = null; }

    if (newValue !== requestedDisabled) {
      try {
        clip.setDisabled(requestedDisabled);
        method = "setDisabled";
      } catch (e) {
        setDisabledError = e.toString();
      }
      try { newValue = clip.disabled; } catch (e) { newValue = newValue; }
    }

    var verified = newValue === requestedDisabled;

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName,
      requestedValue: args.enabled,
      previousValue: previousValue === null ? null : !previousValue,
      newValue: newValue === null ? null : !newValue,
      verified: verified,
      method: method,
      assignError: assignError,
      setDisabledError: setDisabledError
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
