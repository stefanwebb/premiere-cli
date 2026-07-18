// Command: set-source-in-out → ppb_setSourceInOut
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — timeValueToSeconds is already
// defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp source-monitor.ts
// set_source_in_out. Sets in/out points on whatever project item is
// currently open in the Source Monitor via item.setInPoint()/
// setOutPoint(), mediaType 4 ("all") per the reference's own call —
// PREMIERE_API_NOTES.md documents mediaType as 1=video, 2=audio, 4=all.
//
// MUTATION RULE: previous in/out are read via item.getInPoint()/
// getOutPoint() before mutating (same accessor get-source-monitor-info
// uses), and the new values are read back afterward — verified is a
// tolerance-aware comparison against what was requested.
function ppb_setSourceInOut(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasIn = typeof args.inSeconds === "number" && !isNaN(args.inSeconds);
    var hasOut = typeof args.outSeconds === "number" && !isNaN(args.outSeconds);
    if (!hasIn && !hasOut) {
      return JSON.stringify({ ok: false, error: "at least one of inSeconds/outSeconds is required" });
    }

    var item = null;
    try {
      item = app.sourceMonitor.getProjectItem();
    } catch (e2) {
      return JSON.stringify({ ok: false, error: "app.sourceMonitor.getProjectItem() failed: " + e2.toString() });
    }
    if (!item) {
      return JSON.stringify({ ok: false, error: "no clip open in Source Monitor" });
    }

    var previousInSeconds = null;
    var previousOutSeconds = null;
    try { previousInSeconds = timeValueToSeconds(item.getInPoint()); } catch (e3) { previousInSeconds = null; }
    try { previousOutSeconds = timeValueToSeconds(item.getOutPoint()); } catch (e4) { previousOutSeconds = null; }

    var inSetError = null;
    var outSetError = null;

    if (hasIn) {
      try {
        var inTime = new Time();
        inTime.seconds = args.inSeconds;
        item.setInPoint(inTime.ticks, 4);
      } catch (e5) {
        inSetError = e5.toString();
      }
    }

    if (hasOut) {
      try {
        var outTime = new Time();
        outTime.seconds = args.outSeconds;
        item.setOutPoint(outTime.ticks, 4);
      } catch (e6) {
        outSetError = e6.toString();
      }
    }

    var newInSeconds = null;
    var newOutSeconds = null;
    try { newInSeconds = timeValueToSeconds(item.getInPoint()); } catch (e7) { newInSeconds = null; }
    try { newOutSeconds = timeValueToSeconds(item.getOutPoint()); } catch (e8) { newOutSeconds = null; }

    var tolerance = 0.05;
    var inVerified = !hasIn || (inSetError === null && newInSeconds !== null && Math.abs(newInSeconds - args.inSeconds) <= tolerance);
    var outVerified = !hasOut || (outSetError === null && newOutSeconds !== null && Math.abs(newOutSeconds - args.outSeconds) <= tolerance);

    return JSON.stringify({
      ok: true,
      result: {
        item: (function () { try { return item.name; } catch (e) { return null; } })(),
        inSet: hasIn,
        outSet: hasOut,
        previousInSeconds: previousInSeconds,
        previousOutSeconds: previousOutSeconds,
        requestedInSeconds: hasIn ? args.inSeconds : null,
        requestedOutSeconds: hasOut ? args.outSeconds : null,
        newInSeconds: newInSeconds,
        newOutSeconds: newOutSeconds,
        inSetError: inSetError,
        outSetError: outSetError,
        verified: inVerified && outVerified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
