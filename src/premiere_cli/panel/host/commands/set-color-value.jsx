// Command: set-color-value → ppb_setColorValue
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, findComponentProperty, valuesApproximatelyEqual, ...)
// are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `set_color_value` tool (advanced.ts), addressed here by
// trackType/trackIndex/clipIndex + componentName/propertyName (same
// convention as get-effect-properties/set-effect-property) instead of
// node_id. Sets a color-typed property (e.g. a Lumetri tint, a title fill
// color) via prop.setColorValue(alpha, red, green, blue, true) — each
// channel 0-255, per PREMIERE_API_NOTES.md's Property API block. Mutating
// — undo is non-functional on this build, so previousValue is the
// caller's only restoration path.
function ppb_setColorValue(argsJson) {
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

    var channels = ["alpha", "red", "green", "blue"];
    for (var c = 0; c < channels.length; c++) {
      var v = args[channels[c]];
      if (typeof v !== "number" || v < 0 || v > 255) {
        return JSON.stringify({ ok: false, error: channels[c] + " must be a number between 0 and 255" });
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

    var previousValue = null;
    try { previousValue = prop.getValue(); } catch (e) { previousValue = null; }

    var alpha = args.alpha, red = args.red, green = args.green, blue = args.blue;
    var setError = null;
    try {
      prop.setColorValue(alpha, red, green, blue, true);
    } catch (e2) {
      setError = e2.toString();
    }

    var newValue = null;
    try { newValue = prop.getValue(); } catch (e3) { newValue = null; }

    var verified = false;
    if (setError === null) {
      if (newValue instanceof Array && newValue.length === 4) {
        verified = valuesApproximatelyEqual(newValue, [alpha, red, green, blue], 1);
      } else {
        // No confirmed cross-build representation for a color value read
        // back via getValue() (packed int vs. [a,r,g,b] array vs. other) —
        // report the call succeeded without throwing, but don't claim a
        // verified numeric match unless it's the expected 4-element array.
        verified = false;
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
        requestedColor: { alpha: alpha, red: red, green: green, blue: blue },
        previousValue: previousValue,
        newValue: newValue,
        setError: setError,
        verified: verified,
        note: "verified only asserts a match when newValue round-trips as a 4-element [a,r,g,b] array — " +
          "this property's getValue() representation is unconfirmed on this build."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
