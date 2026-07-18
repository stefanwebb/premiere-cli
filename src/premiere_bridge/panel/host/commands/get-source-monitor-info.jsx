// Command: get-source-monitor-info → ppb_getSourceMonitorInfo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use.
//
// Standard-DOM read only — no QE DOM needed. Ported from leancoderkavy's
// premiere-pro-mcp `get_source_monitor_info` tool (source-monitor.ts). No
// clip loaded in the Source Monitor is a valid, truthful "loaded: false"
// result, not an error — same convention as get-premiere-state.

function ppb_getSourceMonitorInfo() {
  try {
    var item = null;
    try {
      item = app.sourceMonitor.getProjectItem();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.sourceMonitor.getProjectItem() failed: " + e.toString() });
    }

    if (!item) {
      return JSON.stringify({ ok: true, result: { loaded: false } });
    }

    var result = { loaded: true, nodeId: null, name: null, mediaPath: null, inPointSeconds: null, outPointSeconds: null };

    try { result.nodeId = item.nodeId; } catch (e) { result.nodeId = null; }
    try { result.name = item.name; } catch (e) { result.name = null; }
    try { result.mediaPath = item.getMediaPath(); } catch (e) { result.mediaPath = null; }
    try { result.inPointSeconds = timeValueToSeconds(item.getInPoint()); } catch (e) { result.inPointSeconds = null; }
    try { result.outPointSeconds = timeValueToSeconds(item.getOutPoint()); } catch (e) { result.outPointSeconds = null; }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
