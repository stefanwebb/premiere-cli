// Command: set-work-area → ppb_setWorkArea
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's playhead.ts set_work_area.
// Sets the given (or active) sequence's work area bar bounds via
// seq.setWorkAreaInPoint()/setWorkAreaOutPoint(), each taking a ticks
// string per PREMIERE_API_NOTES.md's "Work area" row.
function ppb_setWorkArea(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.startSeconds !== "number" || isNaN(args.startSeconds) ||
        typeof args.endSeconds !== "number" || isNaN(args.endSeconds)) {
      return JSON.stringify({ ok: false, error: "startSeconds and endSeconds (numbers) are both required" });
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

    var startTicks = String(Math.round(args.startSeconds * TICKS_PER_SECOND));
    var endTicks = String(Math.round(args.endSeconds * TICKS_PER_SECOND));

    try {
      seq.setWorkAreaInPoint(startTicks);
      seq.setWorkAreaOutPoint(endTicks);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not set work area: " + e.toString() });
    }

    // Read the values back rather than echoing the inputs — live testing
    // 2026-07-17 showed the setters "succeed" (no throw) on Premiere 2026
    // while the work-area reads stay null (the work area bar appears to
    // have been dropped on this build, consistent with
    // isWorkAreaBarEnabled() not existing). readBack lets callers detect
    // that the set didn't actually take effect.
    var readBackIn = null;
    var readBackOut = null;
    try { readBackIn = timeValueToSeconds(seq.workInPoint); } catch (e) { readBackIn = null; }
    try { readBackOut = timeValueToSeconds(seq.workOutPoint); } catch (e) { readBackOut = null; }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        startSeconds: args.startSeconds,
        endSeconds: args.endSeconds,
        readBackInSeconds: readBackIn,
        readBackOutSeconds: readBackOut,
        applied: readBackIn !== null && readBackOut !== null
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
