// Command: get-effect-properties → ppb_getEffectProperties
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, findComponentProperty, ...) are already defined there.
//
// Standard-DOM only — no QE needed. Ported from leancoderkavy's
// premiere-pro-mcp `get_effect_properties` tool (keyframes.ts), addressed
// here by trackType/trackIndex/clipIndex + componentName (same convention
// as get-full-clip-info) instead of node_id/effect_name. Unlike
// get-full-clip-info's per-clip component summary (capped, values
// truncated), this reads ALL properties of ONE named component, uncapped.
// componentName is matched generically against BOTH matchName and
// displayName via the shared findClipComponent() helper — this is not
// hardcoded to Motion/Opacity like the wave-3 transform setters.
function ppb_getEffectProperties(argsJson) {
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
    var compMatchName = null;
    try { compDisplayName = comp.displayName; } catch (e) { compDisplayName = null; }
    try { compMatchName = comp.matchName; } catch (e) { compMatchName = null; }

    var numProps = 0;
    try { numProps = comp.properties.numItems; } catch (e) { numProps = 0; }

    var properties = [];
    for (var p = 0; p < numProps; p++) {
      var prop = comp.properties[p];
      var info = { displayName: null, value: null, isTimeVarying: null, keyCount: null };
      try { info.displayName = prop.displayName; } catch (e1) { info.displayName = null; }
      try { info.value = prop.getValue(); } catch (e2) { info.value = null; }
      try { info.isTimeVarying = prop.isTimeVarying(); } catch (e3) { info.isTimeVarying = null; }
      try {
        if (info.isTimeVarying) {
          var keys = prop.getKeys();
          info.keyCount = keys ? keys.length : 0;
        } else {
          info.keyCount = 0;
        }
      } catch (e4) {
        info.keyCount = null;
      }
      properties.push(info);
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
        matchName: compMatchName,
        properties: properties,
        propertyCount: properties.length
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
