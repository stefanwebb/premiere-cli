// Command: get-work-area → ppb_getWorkArea
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's playhead.ts get_work_area.
// Reads the given (or active) sequence's work area bar bounds
// (seq.workInPoint/seq.workOutPoint — Time-like objects per
// PREMIERE_API_NOTES.md's "Work area" row) and reports them in seconds.
function ppb_getWorkArea(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
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

    var inSeconds = null;
    var outSeconds = null;
    try { inSeconds = timeValueToSeconds(seq.workInPoint); } catch (e) { inSeconds = null; }
    try { outSeconds = timeValueToSeconds(seq.workOutPoint); } catch (e) { outSeconds = null; }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        inSeconds: inSeconds,
        outSeconds: outSeconds
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
