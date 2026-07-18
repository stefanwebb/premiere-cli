// Command: get-workspaces → ppb_getWorkspaces
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's workspace.ts get_workspaces.
// App-level — no project or sequence involved.
function ppb_getWorkspaces(argsJson) {
  try {
    var workspaces = null;
    try {
      workspaces = app.getWorkspaces();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not retrieve workspaces: " + e.toString() });
    }

    if (!workspaces) {
      return JSON.stringify({ ok: false, error: "could not retrieve workspaces" });
    }

    var list = [];
    for (var i = 0; i < workspaces.length; i++) {
      list.push(workspaces[i]);
    }

    return JSON.stringify({ ok: true, result: { workspaces: list, count: list.length } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
