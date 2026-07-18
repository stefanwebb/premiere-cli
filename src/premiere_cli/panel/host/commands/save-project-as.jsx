// Command: save-project-as → ppb_saveProjectAs
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts save_project_as.
// Calls app.project.saveAs(path). NOTE: this switches the currently OPEN
// project (app.project) to point at the new file — it is not a "save a
// copy" operation. Verified by reading app.project.path back afterward
// and confirming it now matches the requested path.

function ppb_saveProjectAs(argsJson) {
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

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    try {
      app.project.saveAs(args.path);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.project.saveAs() failed: " + e.toString() });
    }

    var newPath = null;
    var newName = null;
    try { newPath = app.project.path; } catch (e) { newPath = null; }
    try { newName = app.project.name; } catch (e) { newName = null; }

    var verified = newPath !== null && newPath === args.path;

    return JSON.stringify({
      ok: true,
      result: {
        saved: true,
        requestedPath: args.path,
        path: newPath,
        name: newName,
        verified: verified,
        note: "saveAs() switches the currently open project to the new file — the original file on disk is untouched but is no longer what app.project refers to"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
