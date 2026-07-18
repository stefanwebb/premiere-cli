// Command: apply-lut → ppb_applyLut
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeClipComponents,
// ensureLumetriColorComponent, findComponentProperty, ...) are already
// defined there.
//
// Ensures Lumetri Color is applied (adding it if missing, same helper
// color-correct uses), then sets its "Input LUT" property to a path string
// per PREMIERE_API_NOTES.md. This is a plain string setValue — no numeric
// falsy-check concern here, but the same "0 is legit" caveat from
// color-correct doesn't apply since a LUT path is never numeric.
function ppb_applyLut(argsJson) {
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
    if (typeof args.lutPath !== "string" || !args.lutPath) {
      return JSON.stringify({ ok: false, error: "lutPath must be a non-empty string" });
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

    var prop = findComponentProperty(lumetriComp, ["Input LUT"]);
    if (!prop) {
      return JSON.stringify({ ok: false, error: "could not find an \"Input LUT\" property on Lumetri Color" });
    }

    var previousValue = null;
    try { previousValue = prop.getValue(); } catch (e) { previousValue = null; }

    try {
      prop.setValue(args.lutPath, true);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "prop.setValue(lutPath) failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = prop.getValue(); } catch (e) { newValue = null; }

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
        previousValue: previousValue,
        requestedValue: args.lutPath,
        newValue: newValue,
        verified: newValue === args.lutPath,
        previousComponents: previousComponents,
        newComponents: newComponents
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
