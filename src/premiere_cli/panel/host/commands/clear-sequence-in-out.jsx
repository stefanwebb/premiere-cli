// Command: clear-sequence-in-out → ppb_clearSequenceInOut
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// trySetSequenceRange, timeValueToSeconds, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's track-targeting.ts
// clear_sequence_in_out. The reference implementation sets in=zeroPoint,
// out=seq.end — but per get-sequence-in-out.jsx's live finding, an actually
// UNSET in/out point reads back as Premiere's internal -400000 sentinel,
// not a real in/out range spanning the whole sequence. This command sets
// that literal -400000 sentinel value via the shared trySetSequenceRange()
// helper (its first attempt is the raw "seconds" form — i.e.
// seq.setInPoint(-400000) — which is exactly the value get-sequence-in-out
// reads back for "no point set", live-confirmed working on this build) so
// a subsequent get-sequence-in-out reports {inSeconds: null, outSeconds: null}.
var CLEAR_SEQUENCE_IN_OUT_SENTINEL = -400000;

// Duplicated from get-sequence-in-out.jsx's ppb_pointValueToSeconds (each
// command file loads independently and cannot rely on another command
// file's helpers) — treats Premiere's -400000-ish sentinel as "unset".
function ppbSentinelPointToSeconds(value) {
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
    return null;
  }
  return seconds;
}

function ppb_clearSequenceInOut(argsJson) {
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

    var previousIn = null;
    var previousOut = null;
    try { previousIn = ppbSentinelPointToSeconds(seq.getInPoint()); } catch (e) { previousIn = null; }
    try { previousOut = ppbSentinelPointToSeconds(seq.getOutPoint()); } catch (e) { previousOut = null; }

    var rangeResult = trySetSequenceRange(seq, CLEAR_SEQUENCE_IN_OUT_SENTINEL, CLEAR_SEQUENCE_IN_OUT_SENTINEL);
    if (!rangeResult.ok) {
      return JSON.stringify({
        ok: false,
        error: "could not clear sequence in/out points with any known argument form",
        attempts: rangeResult.attempts,
        previousInSeconds: previousIn,
        previousOutSeconds: previousOut
      });
    }

    var newIn = null;
    var newOut = null;
    try { newIn = ppbSentinelPointToSeconds(seq.getInPoint()); } catch (e) { newIn = null; }
    try { newOut = ppbSentinelPointToSeconds(seq.getOutPoint()); } catch (e) { newOut = null; }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        previousInSeconds: previousIn,
        previousOutSeconds: previousOut,
        inSeconds: newIn,
        outSeconds: newOut,
        verified: newIn === null && newOut === null,
        attempts: rangeResult.attempts
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
