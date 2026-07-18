// Command: close-all-source-clips → ppb_closeAllSourceClips
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use.
//
// Ported from leancoderkavy's premiere-pro-mcp source-monitor.ts
// close_all_source_clips. Closes every clip currently open across the
// Source Monitor's tabs via app.sourceMonitor.closeAllClips().
//
// MUTATION RULE: verified the same way as close-source-monitor — a null
// getProjectItem() read-back afterward confirms nothing is left loaded.
function ppb_closeAllSourceClips() {
  try {
    try {
      app.sourceMonitor.closeAllClips();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.sourceMonitor.closeAllClips() failed: " + e.toString() });
    }

    var stillLoaded = null;
    try {
      stillLoaded = app.sourceMonitor.getProjectItem();
    } catch (e2) {
      stillLoaded = null;
    }

    return JSON.stringify({
      ok: true,
      result: { closed: true, verified: !stillLoaded }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
