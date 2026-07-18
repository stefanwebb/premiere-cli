// Command: set-anti-alias-quality → ppb_setAntiAliasQuality
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, setComponentProperty, ...) are already defined there.
//
// Standard-DOM only — no QE needed. Ported from leancoderkavy's
// premiere-pro-mcp `set_anti_alias_quality` tool (track-targeting.ts),
// addressed here by trackType/trackIndex/clipIndex (same convention as
// get-full-clip-info) instead of node_id.
//
// **API UNCERTAIN**: no property named anything like "Anti-Alias" or
// "Anti-Alias Quality" is documented for the Motion component in
// PREMIERE_API_NOTES.md, and the reference tool itself only probes two
// loosely-related displayNames ("Anti-flicker Filter",
// "Use Composition's Shutter Angle") — neither is really an anti-alias
// control. This command probes a short list of plausible displayNames on
// the Motion component and returns an honest "not found on this Premiere
// build" error (naming every name tried) if none exist, rather than
// silently mutating an unrelated property. Mutating IF a match is found —
// undo is non-functional on this build, so previousValue in the result is
// the caller's only restoration path.

var SET_ANTI_ALIAS_QUALITY_CANDIDATE_NAMES = [
  "Anti-flicker Filter",
  "Anti-aliasing Quality",
  "Anti-Alias Quality",
  "Antialias Quality",
  "Use Composition's Shutter Angle"
];

function ppb_setAntiAliasQuality(argsJson) {
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
    if (typeof args.amount !== "number" || args.amount < 0 || args.amount > 1) {
      return JSON.stringify({ ok: false, error: "amount must be a number between 0 and 1" });
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

    var motion = findClipComponent(clip, ["AE.ADBE Motion"], ["Motion"]);
    if (!motion) {
      return JSON.stringify({ ok: false, error: "Motion component not found on clip" });
    }

    // Live-discovered 2026-07-17: the boolean form throws "Illegal
    // Parameter type" — Motion's real property here is the NUMERIC
    // "Anti-flicker Filter" (0..1 amount).
    var setResult = setComponentProperty(motion, SET_ANTI_ALIAS_QUALITY_CANDIDATE_NAMES, args.amount);
    if (!setResult.found) {
      return JSON.stringify({
        ok: false,
        error: "no anti-alias-quality-like property exists on the Motion component on this Premiere build (tried: " + SET_ANTI_ALIAS_QUALITY_CANDIDATE_NAMES.join(", ") + ")"
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: clipName,
        previousValue: setResult.previousValue,
        requestedValue: setResult.requestedValue,
        newValue: setResult.newValue,
        verified: setResult.verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
