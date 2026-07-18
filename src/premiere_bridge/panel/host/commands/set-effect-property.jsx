// Command: set-effect-property → ppb_setEffectProperty
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, findComponentProperty, setComponentProperty, ...) are
// already defined there.
//
// Standard-DOM only — no QE needed. Ported from leancoderkavy's
// premiere-pro-mcp `set_effect_property` tool (keyframes.ts), addressed
// here by trackType/trackIndex/clipIndex + componentName/propertyName
// (same convention as get-effect-properties) instead of node_id. Unlike
// the reference tool (numbers only), this accepts number/string/boolean
// via an explicit valueType field for unambiguous typing over the wire —
// premiere_cli.py coerces --value to the right JSON type before sending
// based on --value-type. Mutating — undo is non-functional on this build,
// so previousValue is the caller's only restoration path.
function ppb_setEffectProperty(argsJson) {
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
    if (args.valueType !== "number" && args.valueType !== "string" && args.valueType !== "boolean") {
      return JSON.stringify({ ok: false, error: "valueType must be \"number\", \"string\", or \"boolean\"" });
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

    var comp = findClipComponent(clip, [args.componentName], [args.componentName]);
    if (!comp) {
      return JSON.stringify({
        ok: false,
        error: "component \"" + args.componentName + "\" not found on clip (matched against matchName and displayName)"
      });
    }
    var compDisplayName = null;
    try { compDisplayName = comp.displayName; } catch (e) { compDisplayName = null; }

    var setResult = setComponentProperty(comp, [args.propertyName], args.value);
    if (!setResult.found) {
      return JSON.stringify({
        ok: false,
        error: "property \"" + args.propertyName + "\" not found on component \"" + compDisplayName + "\""
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
        componentName: compDisplayName,
        propertyName: args.propertyName,
        valueType: args.valueType,
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
