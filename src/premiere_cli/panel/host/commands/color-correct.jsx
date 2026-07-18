// Command: color-correct → ppb_colorCorrect
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeClipComponents,
// ensureLumetriColorComponent, valuesApproximatelyEqual, ...) are already
// defined there.
//
// Ensures Lumetri Color is applied (via ensureLumetriColorComponent, adding
// it through the standard QE dance if missing), then sets any of
// exposure/contrast/saturation/temperature/tint by displayName. Per
// PREMIERE_API_NOTES.md, Lumetri repeats display names across its
// sub-sections (Basic Correction, Creative, HSL Secondary, ...) and not
// every match is writable — for each requested control, every matching
// property is tried in order until one setValue() doesn't throw ("first
// writable match wins"); previous/new values are read from that exact
// property index, not re-scanned from the top (which could otherwise grab
// an unrelated same-named property). 0 is a legitimate value for every one
// of these controls (e.g. full desaturate) — never falsy-checked.
function ppb_colorCorrect(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.trackType !== "video") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" — Lumetri Color is a video effect" });
    }
    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.clipIndex !== "number" || args.clipIndex < 0 || Math.floor(args.clipIndex) !== args.clipIndex) {
      return JSON.stringify({ ok: false, error: "clipIndex must be a non-negative integer" });
    }

    var CONTROLS = [
      { key: "exposure", label: "Exposure" },
      { key: "contrast", label: "Contrast" },
      { key: "saturation", label: "Saturation" },
      { key: "temperature", label: "Temperature" },
      { key: "tint", label: "Tint" }
    ];
    var requested = [];
    for (var c = 0; c < CONTROLS.length; c++) {
      if (typeof args[CONTROLS[c].key] === "number") {
        requested.push(CONTROLS[c]);
      }
    }
    if (requested.length === 0) {
      return JSON.stringify({ ok: false, error: "at least one of exposure, contrast, saturation, temperature, tint is required" });
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

    var resolvedClip = resolveTimelineClip(seq, "video", args.trackIndex, args.clipIndex);
    if (resolvedClip.error) {
      return JSON.stringify({ ok: false, error: resolvedClip.error });
    }
    var clip = resolvedClip.clip;
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var previousComponents = serializeClipComponents(clip);

    var lumetri = ensureLumetriColorComponent(seq, "video", args.trackIndex, args.clipIndex, clip);
    if (lumetri.error) {
      return JSON.stringify({ ok: false, error: lumetri.error });
    }
    var lumetriComp = lumetri.component;

    var changes = {};
    var numProps;
    try {
      numProps = lumetriComp.properties.numItems;
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read Lumetri Color's properties: " + e.toString() });
    }

    for (var r = 0; r < requested.length; r++) {
      var key = requested[r].key;
      var label = requested[r].label;
      var value = args[key];

      var previousValue = null;
      var havePrevious = false;
      var applied = false;
      var appliedIndex = -1;
      var errorMsg = null;

      for (var p = 0; p < numProps; p++) {
        var prop = lumetriComp.properties[p];
        var dn = null;
        try { dn = prop.displayName; } catch (e2) { dn = null; }
        if (dn !== label) {
          continue;
        }
        if (!havePrevious) {
          try { previousValue = prop.getValue(); } catch (e3) { previousValue = null; }
          havePrevious = true;
        }
        if (!applied) {
          try {
            prop.setValue(value, true);
            applied = true;
            appliedIndex = p;
          } catch (e4) {
            errorMsg = e4.toString();
          }
        }
      }

      var newValue = null;
      if (applied) {
        try { newValue = lumetriComp.properties[appliedIndex].getValue(); } catch (e5) { newValue = null; }
      }

      changes[key] = {
        displayName: label,
        previousValue: previousValue,
        requestedValue: value,
        newValue: newValue,
        applied: applied,
        verified: applied && valuesApproximatelyEqual(newValue, value),
        error: applied ? null : (errorMsg || "no writable property named \"" + label + "\" found on Lumetri Color")
      };
    }

    var newComponents = serializeClipComponents(clip);

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: "video",
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: clipName,
        lumetriApplied: lumetri.applied,
        changes: changes,
        previousComponents: previousComponents,
        newComponents: newComponents
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
