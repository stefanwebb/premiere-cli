// Command: redo → ppb_redo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// REWRITTEN 2026-07-17 after the probe session (see BUILD_FINDINGS.md
// corrections): qe.project.redo() WORKS on this build — live-verified
// re-applying an undone setSpeed, with qe.project.undoStackIndex()
// (an int-returning function) incrementing on a real redo. That index
// is the verification primitive; app.project.redo() does not exist here.

function ppb_redo(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    try {
      ensureQEEnabled();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project || typeof qe.project.redo !== "function") {
      return JSON.stringify({ ok: false, error: "qe.project.redo is not available on this Premiere build" });
    }

    function readStackIndex() {
      try {
        if (typeof qe.project.undoStackIndex === "function") {
          return qe.project.undoStackIndex();
        }
      } catch (e2) {
        // fall through
      }
      return null;
    }

    var indexBefore = readStackIndex();
    try {
      qe.project.redo();
    } catch (e3) {
      return JSON.stringify({ ok: false, error: "qe.project.redo() threw: " + e3.toString() });
    }
    var indexAfter = readStackIndex();

    var verified = null;
    if (indexBefore !== null && indexAfter !== null) {
      verified = indexAfter > indexBefore;
    }

    return JSON.stringify({
      ok: true,
      result: {
        redone: verified !== false,
        verified: verified,
        method: "qe.project.redo",
        undoStackIndexBefore: indexBefore,
        undoStackIndexAfter: indexAfter,
        note: verified === null
          ? "undoStackIndex() unavailable — this only confirms the call did not throw"
          : (verified
            ? "verified via qe.project.undoStackIndex() incrementing"
            : "the stack index did not move — there was nothing to redo")
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
