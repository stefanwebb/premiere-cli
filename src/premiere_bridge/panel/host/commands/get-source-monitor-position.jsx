// Command: get-source-monitor-position → ppb_getSourceMonitorPosition
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// timeValueToSeconds, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's playback.ts
// get_source_monitor_position. Standard DOM (app.sourceMonitor.getPosition())
// — no sequence involved. Fails if no clip is currently open in the
// Source Monitor.
function ppb_getSourceMonitorPosition(argsJson) {
  try {
    var pos = null;
    try {
      pos = app.sourceMonitor.getPosition();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read source monitor position: " + e.toString() });
    }

    if (pos === null || typeof pos === "undefined") {
      return JSON.stringify({ ok: false, error: "no clip open in Source Monitor" });
    }

    var seconds = null;
    try { seconds = timeValueToSeconds(pos); } catch (e) { seconds = null; }

    return JSON.stringify({ ok: true, result: { seconds: seconds } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
