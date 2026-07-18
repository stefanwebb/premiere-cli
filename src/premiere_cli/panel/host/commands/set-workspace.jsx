// Command: set-workspace → ppb_setWorkspace
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's workspace.ts set_workspace.
// App-level — no project or sequence involved.
function ppb_setWorkspace(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.name !== "string" || args.name.length === 0) {
      return JSON.stringify({ ok: false, error: "name (string) is required" });
    }

    var result = null;
    try {
      result = app.setWorkspace(args.name);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "failed to set workspace \"" + args.name + "\": " + e.toString() });
    }

    if (!result) {
      return JSON.stringify({ ok: false, error: "failed to set workspace: " + args.name });
    }

    return JSON.stringify({ ok: true, result: { set: true, workspace: args.name } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
