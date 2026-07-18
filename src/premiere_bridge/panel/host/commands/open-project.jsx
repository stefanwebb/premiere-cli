// Command: open-project → ppb_openProject
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts open_project.
// Calls app.openDocument(path). WARNING (per PREMIERE_API_NOTES.md and
// set-active-project.jsx's header note): app.openDocument's behavior is
// only loosely documented — it may pop a dialog (unsupported project
// version, missing media relink prompts, etc.), and its behavior when the
// path is already open elsewhere is unconfirmed. A blocking dialog will
// freeze the CEP bridge until a human dismisses it in Premiere. Checks
// the file exists on disk before calling, to at least rule out that
// failure mode cheaply. Verified by reading app.project.path back
// afterward.

function ppb_openProject(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.path || typeof args.path !== "string") {
      return JSON.stringify({ ok: false, error: "path is required" });
    }

    var file = new File(args.path);
    if (!file.exists) {
      return JSON.stringify({ ok: false, error: "no file exists at path: " + args.path });
    }

    try {
      app.openDocument(args.path);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.openDocument() failed: " + e.toString() });
    }

    var newPath = null;
    var newName = null;
    try { newPath = app.project ? app.project.path : null; } catch (e) { newPath = null; }
    try { newName = app.project ? app.project.name : null; } catch (e) { newName = null; }

    var verified = newPath !== null && newPath === args.path;

    return JSON.stringify({
      ok: true,
      result: {
        opened: true,
        requestedPath: args.path,
        path: newPath,
        name: newName,
        verified: verified,
        note: "app.openDocument() may pop a blocking dialog on this build (unsupported version, missing-media relink, etc.) — if the call hangs, a human needs to dismiss a dialog in Premiere itself"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
