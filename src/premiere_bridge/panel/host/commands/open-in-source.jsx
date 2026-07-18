// Command: open-in-source → ppb_openInSource
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy's premiere-pro-mcp source-monitor.ts
// open_in_source. Resolves a project item by nodeId/name (same recursive
// bin walk as add-to-timeline/replace-clip) and opens it in the Source
// Monitor via app.sourceMonitor.openProjectItem(item).
//
// MUTATION RULE: verified by reading app.sourceMonitor.getProjectItem()
// back afterward and confirming its nodeId matches the requested item —
// never trusting openProjectItem()'s own (undocumented) return value.

function ppbFindItemOpenInSource_walk(item, args, depth) {
  if (depth > 32) {
    return null;
  }
  var isBin = false;
  try {
    isBin = typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    isBin = false;
  }
  var matched = false;
  if (args.nodeId !== null) {
    try { matched = item.nodeId === args.nodeId; } catch (e) { matched = false; }
  } else if (args.name !== null) {
    try { matched = item.name === args.name; } catch (e) { matched = false; }
  }
  if (matched) {
    return item;
  }
  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbFindItemOpenInSource_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemOpenInSource_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemOpenInSource_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_openInSource(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasNodeId = typeof args.nodeId === "string" && args.nodeId.length > 0;
    var hasName = typeof args.name === "string" && args.name.length > 0;
    if (!hasNodeId && !hasName) {
      return JSON.stringify({ ok: false, error: "either nodeId or name is required to identify the project item" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemOpenInSource_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var itemNodeId = null;
    var itemName = null;
    try { itemNodeId = item.nodeId; } catch (e1) { itemNodeId = null; }
    try { itemName = item.name; } catch (e2) { itemName = null; }

    try {
      app.sourceMonitor.openProjectItem(item);
    } catch (e3) {
      return JSON.stringify({ ok: false, error: "app.sourceMonitor.openProjectItem() failed: " + e3.toString() });
    }

    var verifiedItem = null;
    var verified = false;
    try {
      verifiedItem = app.sourceMonitor.getProjectItem();
      if (verifiedItem) {
        var verifiedNodeId = null;
        try { verifiedNodeId = verifiedItem.nodeId; } catch (e4) { verifiedNodeId = null; }
        verified = verifiedNodeId !== null && verifiedNodeId === itemNodeId;
      }
    } catch (e5) {
      verified = false;
    }

    return JSON.stringify({
      ok: true,
      result: {
        opened: true,
        item: { name: itemName, nodeId: itemNodeId },
        verified: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
