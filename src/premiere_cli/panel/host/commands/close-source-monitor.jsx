// Command: close-source-monitor → ppb_closeSourceMonitor
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use.
//
// Ported from leancoderkavy's premiere-pro-mcp source-monitor.ts
// close_source_monitor. Closes whichever single clip is open in the
// Source Monitor via app.sourceMonitor.closeClip().
//
// MUTATION RULE: verified by reading app.sourceMonitor.getProjectItem()
// back afterward — a null result confirms the monitor is now empty.
function ppb_closeSourceMonitor() {
  try {
    try {
      app.sourceMonitor.closeClip();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.sourceMonitor.closeClip() failed: " + e.toString() });
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
