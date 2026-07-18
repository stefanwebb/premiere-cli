// Command: set-sequence-in-out → ppb_setSequenceInOut
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, trySetSequenceRange, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's playhead.ts
// set_sequence_in_out_points. Sets the given (or active) sequence's
// in/out points (used for export range, etc.) — reuses the shared
// trySetSequenceRange() helper (seconds, then ticksString, then Time
// object) rather than a single-form seq.setInPoint()/setOutPoint() call,
// since PREMIERE_API_NOTES.md flags that call's argument type as
// disagreeing across the reference repos.
function ppb_setSequenceInOut(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.inSeconds !== "number" || isNaN(args.inSeconds) ||
        typeof args.outSeconds !== "number" || isNaN(args.outSeconds)) {
      return JSON.stringify({ ok: false, error: "inSeconds and outSeconds (numbers) are both required" });
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

    var rangeResult = trySetSequenceRange(seq, args.inSeconds, args.outSeconds);
    if (!rangeResult.ok) {
      return JSON.stringify({
        ok: false,
        error: "could not set sequence in/out points with any known argument form",
        attempts: rangeResult.attempts
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        inSeconds: args.inSeconds,
        outSeconds: args.outSeconds,
        attempts: rangeResult.attempts
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
