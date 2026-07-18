// Command: undo → ppb_undo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// REWRITTEN 2026-07-17 after the probe session (see BUILD_FINDINGS.md
// corrections): qe.project.undo() WORKS on this build for operations
// that enter the undo stack — the earlier "silent no-op" finding was an
// artifact of testing with marker-add/track-rename, which NEVER enter
// the stack. qe.project.undoStackIndex() (an int-returning function on
// this build) is the verification primitive: a real undo decrements it.
//
// CAUTION for callers: if YOUR last operation didn't enter the undo
// stack (markers, track renames, ...), undo() pops whatever IS on top —
// possibly the user's own last edit. This command therefore refuses to
// keep looping once the stack index stops moving, and reports the index
// trajectory so the caller can tell exactly how many stack entries were
// popped.

function ppb_undo(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var count = typeof args.count === "number" ? args.count : 1;
    if (isNaN(count) || Math.floor(count) !== count || count < 1) {
      return JSON.stringify({ ok: false, error: "count must be a positive integer" });
    }
    var requestedCount = count;
    if (count > 50) {
      count = 50;
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    try {
      ensureQEEnabled();
    } catch (e2) {
      return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e2.toString() });
    }
    if (typeof qe === "undefined" || !qe.project || typeof qe.project.undo !== "function") {
      return JSON.stringify({ ok: false, error: "qe.project.undo is not available on this Premiere build" });
    }

    function readStackIndex() {
      try {
        if (typeof qe.project.undoStackIndex === "function") {
          return qe.project.undoStackIndex();
        }
      } catch (e) {
        // fall through
      }
      return null;
    }

    var indexBefore = readStackIndex();
    var undoneCount = 0;
    var stopError = null;
    var stackExhausted = false;

    for (var i = 0; i < count; i++) {
      var idxPre = readStackIndex();
      try {
        qe.project.undo();
      } catch (e3) {
        stopError = e3.toString();
        break;
      }
      var idxPost = readStackIndex();
      if (idxPre !== null && idxPost !== null) {
        if (idxPost < idxPre) {
          undoneCount++;
        } else {
          // the call no-opped — the stack is exhausted (or this op class
          // isn't undoable); looping further would be pointless
          stackExhausted = true;
          break;
        }
      } else {
        // no index available to verify against — count the non-throwing
        // call, but flag the weaker evidence in the result note
        undoneCount++;
      }
    }

    var indexAfter = readStackIndex();

    return JSON.stringify({
      ok: true,
      result: {
        requestedCount: requestedCount,
        cappedCount: count,
        undoneCount: undoneCount,
        stoppedEarly: undoneCount < count,
        stackExhausted: stackExhausted,
        stopError: stopError,
        method: "qe.project.undo",
        undoStackIndexBefore: indexBefore,
        undoStackIndexAfter: indexAfter,
        note: indexBefore !== null
          ? "verified via qe.project.undoStackIndex() — each counted undo decremented the stack index. CAUTION: some operations (markers, track renames) never enter the undo stack; undoing after one of those pops the NEXT stack entry instead."
          : "undoStackIndex() unavailable — undoneCount only reports non-throwing undo calls"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
