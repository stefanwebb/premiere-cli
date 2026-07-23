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
//
// CORRECTED 2026-07-23: "Input LUT" IS settable — it takes an INTEGER
// INDEX into Premiere's already-loaded LUT dropdown, not a path string.
// Live-verified via set-effect-property (--value 1 --value-type number,
// read-back confirmed). So this command's whole premise — passing a
// filesystem path — is wrong for this build, which is why every string
// form below fails. A .cube can be chosen programmatically only once it
// is already registered in that dropdown (browse to it once in the UI, or
// install it into Premiere's LUT folder); registering a NEW file by path
// from script still has no known API. Prefer `set-effect-property` with
// the index. The original (incorrect) conclusion follows, kept because
// the argument-form matrix it records is still accurate:
//
// LIVE FINDING 2026-07-22, Premiere Pro 26.3.0 (build 93): "Input LUT" is
// NOT SCRIPTABLE via ComponentParam.setValue() on this build, full stop —
// this is not a which-property or which-argument-form problem.
//
// Investigation: this component has TWO properties named "Input LUT"
// (confirmed via inspect-dom-object), so the first fix tried was the same
// "loop every same-named property, first writable one wins" pattern
// color-correct.jsx uses for its own repeated-displayName problem. Both
// properties rejected a plain path string identically. Widening further,
// 5 argument forms were tried against EACH property (bare path string,
// path + `true`, an ExtendScript `File` object, `File` + `true`, and
// `File.fsName`) — all 10 combinations failed with the exact same
// "Illegal Parameter type" error. That uniformity across every property x
// argument-form combination is strong evidence this isn't a signature we
// haven't found yet: `get-full-clip-info` dumps of this same Lumetri
// component show several properties (`Blob`, the HSL-secondary mask
// selectors, etc.) holding garbled/binary-looking values rather than
// plain strings or numbers — "Input LUT" is almost certainly the same
// opaque blob-typed parameter, and Adobe's ExtendScript API doesn't
// appear to expose a way to construct that value from a filesystem path.
//
// This function is KEPT (not removed) because it still does something
// useful and verifiable: it ensures Lumetri Color is applied to the clip,
// and the `attempts` array in its failure result is genuinely informative
// diagnostic data if a future Premiere build changes this behavior — but
// setting Input LUT programmatically should be treated as UNSUPPORTED on
// this build. The confirmed working path is manual: Lumetri Color panel →
// Basic Correction → Input LUT → Browse... in the Premiere Pro UI itself.
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

    var numProps;
    try {
      numProps = lumetriComp.properties.numItems;
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read Lumetri Color's properties: " + e.toString() });
    }

    var previousValue = null;
    var havePrevious = false;
    var applied = false;
    var appliedIndex = -1;
    var attempts = [];

    for (var p = 0; p < numProps; p++) {
      var prop = lumetriComp.properties[p];
      var dn = null;
      try { dn = prop.displayName; } catch (e2) { dn = null; }
      if (dn !== "Input LUT") {
        continue;
      }
      if (!havePrevious) {
        try { previousValue = prop.getValue(); } catch (e3) { previousValue = null; }
        havePrevious = true;
      }
      if (!applied) {
        // Both same-named properties reject a bare path string identically
        // (LIVE FINDING 2026-07-22) — so this isn't a which-property
        // problem, it's a which-ARGUMENT-FORM problem. Try every plausible
        // form per property, same "attempts" pattern used elsewhere in this
        // codebase for disputed ExtendScript signatures (add-transition,
        // set-clip-speed, ...).
        var candidateForms = [
          { label: "path, true", fn: function () { prop.setValue(args.lutPath, true); } },
          { label: "path only", fn: function () { prop.setValue(args.lutPath); } },
          { label: "File object, true", fn: function () { prop.setValue(new File(args.lutPath), true); } },
          { label: "File object only", fn: function () { prop.setValue(new File(args.lutPath)); } },
          { label: "file:// URI, true", fn: function () { prop.setValue(new File(args.lutPath).fsName, true); } }
        ];
        for (var f = 0; f < candidateForms.length; f++) {
          try {
            candidateForms[f].fn();
            applied = true;
            appliedIndex = p;
            attempts.push({ propertyIndex: p, form: candidateForms[f].label, success: true });
            break;
          } catch (e4) {
            attempts.push({ propertyIndex: p, form: candidateForms[f].label, success: false, error: e4.toString() });
          }
        }
      }
    }

    if (!havePrevious) {
      return JSON.stringify({ ok: false, error: "could not find an \"Input LUT\" property on Lumetri Color" });
    }
    if (!applied) {
      return JSON.stringify({ ok: false, error: "prop.setValue(lutPath) failed on every \"Input LUT\" property found", attempts: attempts });
    }

    var newValue = null;
    try { newValue = lumetriComp.properties[appliedIndex].getValue(); } catch (e) { newValue = null; }

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
        appliedPropertyIndex: appliedIndex,
        attempts: attempts,
        previousComponents: previousComponents,
        newComponents: newComponents
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
