// Command: get-sequence-in-out → ppb_getSequenceInOut
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's playhead.ts
// get_sequence_in_out_points. Reads the given (or active) sequence's
// in/out points via seq.getInPoint()/getOutPoint().
//
// Live-tested 2026-07-17 on Premiere Pro 2026: getInPoint()/getOutPoint()
// return SECONDS as a string (setting in=10s reads back "10"), NOT ticks —
// the original raw-ticks interpretation shrank real values by 11 orders of
// magnitude. An UNSET point reads as Premiere's -400000 sentinel, reported
// here as null. Time-like objects (other builds) still go through
// timeValueToSeconds.
function ppb_pointValueToSeconds(value) {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value === "object") {
    return timeValueToSeconds(value);
  }
  var seconds = Number(value);
  if (isNaN(seconds)) {
    return null;
  }
  if (seconds <= -399999) {
    // Premiere's "no in/out point set" sentinel
    return null;
  }
  return seconds;
}

function ppb_getSequenceInOut(argsJson) {
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
    try { inSeconds = ppb_pointValueToSeconds(seq.getInPoint()); } catch (e) { inSeconds = null; }
    try { outSeconds = ppb_pointValueToSeconds(seq.getOutPoint()); } catch (e) { outSeconds = null; }

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
