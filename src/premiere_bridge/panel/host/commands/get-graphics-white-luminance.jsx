// Command: get-graphics-white-luminance → ppb_getGraphicsWhiteLuminance
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// READ-only. Ported from leancoderkavy/premiere-pro-mcp's project.ts
// get_graphics_white_luminance: app.project.getGraphicsWhiteLuminance() —
// the HDR graphics-white-luminance setting (in nits), not documented
// elsewhere in PREMIERE_API_NOTES.md. Pairs with
// set-graphics-white-luminance.jsx.

function ppb_getGraphicsWhiteLuminance(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    if (typeof app.project.getGraphicsWhiteLuminance !== "function") {
      return JSON.stringify({ ok: false, error: "getGraphicsWhiteLuminance is not available on this Premiere build" });
    }

    var value = null;
    try {
      value = app.project.getGraphicsWhiteLuminance();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getGraphicsWhiteLuminance() failed: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { graphicsWhiteLuminance: value } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
