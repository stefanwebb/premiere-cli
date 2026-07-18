// Command: set-graphics-white-luminance → ppb_setGraphicsWhiteLuminance
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Write-side counterpart of get-graphics-white-luminance.jsx. Ported from
// leancoderkavy/premiere-pro-mcp's project.ts
// set_graphics_white_luminance: app.project.setGraphicsWhiteLuminance(value)
// — the HDR graphics-white-luminance setting, in nits. previousValue/
// newValue read via getGraphicsWhiteLuminance() before/after (when
// available); `verified` compares newValue against the requested value.
// Undo is NON-FUNCTIONAL on this build — previousValue is the only
// restoration path.

function ppb_setGraphicsWhiteLuminance(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.value !== "number") {
      return JSON.stringify({ ok: false, error: "value (number, in nits) is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    if (typeof app.project.setGraphicsWhiteLuminance !== "function") {
      return JSON.stringify({ ok: false, error: "setGraphicsWhiteLuminance is not available on this Premiere build" });
    }

    var hasGetter = typeof app.project.getGraphicsWhiteLuminance === "function";
    var previousValue = null;
    if (hasGetter) {
      try { previousValue = app.project.getGraphicsWhiteLuminance(); } catch (e) { previousValue = null; }
    }

    try {
      app.project.setGraphicsWhiteLuminance(args.value);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setGraphicsWhiteLuminance() failed: " + e.toString() });
    }

    var newValue = null;
    if (hasGetter) {
      try { newValue = app.project.getGraphicsWhiteLuminance(); } catch (e) { newValue = null; }
    }

    var verified = null;
    var note = null;
    if (hasGetter && newValue !== null) {
      verified = newValue === args.value;
    } else {
      note = "no read-back getter is available on this build — verification is call-level only (setGraphicsWhiteLuminance() did not throw)";
    }

    return JSON.stringify({
      ok: true,
      result: {
        set: true,
        requestedValue: args.value,
        previousValue: previousValue,
        newValue: newValue,
        verified: verified,
        note: note
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
