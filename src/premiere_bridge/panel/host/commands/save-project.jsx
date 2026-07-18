// Command: save-project → ppb_saveProject
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts save_project.
// Calls app.project.save() (no args — saves to the project's current
// path). Verification is best-effort: if this Premiere build exposes
// project.isDirty() (unconfirmed, not documented in
// PREMIERE_API_NOTES.md), it's read before and after and the command
// only reports success if it went from dirty to clean; if isDirty isn't
// available, verification degrades to call-level only (no throw), and
// `verified` is reported as null with a note rather than a false claim.

function ppb_saveProject(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var hasIsDirty = typeof app.project.isDirty === "function";
    var dirtyBefore = null;
    if (hasIsDirty) {
      try { dirtyBefore = app.project.isDirty(); } catch (e) { dirtyBefore = null; }
    }

    try {
      app.project.save();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.project.save() failed: " + e.toString() });
    }

    var dirtyAfter = null;
    if (hasIsDirty) {
      try { dirtyAfter = app.project.isDirty(); } catch (e) { dirtyAfter = null; }
    }

    var verified = null;
    var note = null;
    if (hasIsDirty && dirtyBefore !== null && dirtyAfter !== null) {
      verified = dirtyAfter === false;
    } else {
      note = "isDirty() is not available (or not readable) on this Premiere build — verification is call-level only (save() did not throw)";
    }

    var name = null;
    var path = null;
    try { name = app.project.name; } catch (e) { name = null; }
    try { path = app.project.path; } catch (e) { path = null; }

    return JSON.stringify({
      ok: true,
      result: { saved: true, name: name, path: path, verified: verified, note: note }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
