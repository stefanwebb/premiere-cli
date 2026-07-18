// Command: create-smart-bin → ppb_createSmartBin
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts create_smart_bin.
// Calls rootItem.createSmartBin(name, query) — per PREMIERE_API_NOTES.md.
// Verified by a root-bin children-count increase and locating the newly-
// appeared bin by name (never trusting the call's own return value, same
// distrust pattern as add-adjustment-layer.jsx's item creation step).
// query syntax is Premiere's own search-bin query language — not
// validated here, any failure surfaces as either a thrown exception or a
// silent no-op (count doesn't increase).

function ppb_createSmartBin(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.name || typeof args.name !== "string") {
      return JSON.stringify({ ok: false, error: "name is required" });
    }
    if (!args.query || typeof args.query !== "string") {
      return JSON.stringify({ ok: false, error: "query is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var root = app.project.rootItem;
    if (typeof root.createSmartBin !== "function") {
      return JSON.stringify({ ok: false, error: "createSmartBin is not available on this Premiere build" });
    }

    var countBefore = root.children.numItems;

    try {
      root.createSmartBin(args.name, args.query);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "createSmartBin() failed: " + e.toString() });
    }

    var freshChildren = app.project.rootItem.children;
    var countAfter = freshChildren.numItems;
    var created = countAfter > countBefore;

    var newBin = null;
    if (created) {
      for (var i = freshChildren.numItems - 1; i >= 0; i--) {
        var it = freshChildren[i];
        var itName = null;
        try { itName = it.name; } catch (e) { itName = null; }
        if (itName === args.name) {
          newBin = it;
          break;
        }
      }
    }

    if (!created || !newBin) {
      return JSON.stringify({
        ok: false,
        error: "createSmartBin() did not throw, but no new bin named \"" + args.name + "\" was found afterward",
        countBefore: countBefore,
        countAfter: countAfter
      });
    }

    return JSON.stringify({
      ok: true,
      result: { created: true, name: args.name, query: args.query, nodeId: newBin.nodeId }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
