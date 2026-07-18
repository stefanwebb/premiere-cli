// Command: rename-project-item → ppb_renameProjectItem
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's utility.ts rename_project_item tool. Item
// resolution by nodeId/name uses children-presence recursion (NOT an
// isBin() gate), per get-project-item-info.jsx's live-debugged finding.
// Renames via the documented item.name = x assignment, verified via a
// name read-back. Undo is non-functional on this build — previousValue is
// the only restoration path.

function ppbRenameProjectItem_findByNodeId(item, nodeId, depth) {
  if (depth > 32) {
    return null;
  }
  try {
    if (item.nodeId === nodeId) {
      return item;
    }
  } catch (e) {
    // fall through
  }
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbRenameProjectItem_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbRenameProjectItem_findByName(item, name, depth) {
  if (depth > 32) {
    return null;
  }
  try {
    if (item.name === name) {
      return item;
    }
  } catch (e) {
    // fall through
  }
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbRenameProjectItem_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppb_renameProjectItem(argsJson) {
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
      return JSON.stringify({ ok: false, error: "either nodeId or name is required" });
    }
    if (!args.newName || typeof args.newName !== "string") {
      return JSON.stringify({ ok: false, error: "newName is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = hasNodeId
      ? ppbRenameProjectItem_findByNodeId(app.project.rootItem, args.nodeId, 0)
      : ppbRenameProjectItem_findByName(app.project.rootItem, args.name, 0);
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var previousValue = null;
    try { previousValue = item.name; } catch (e) { previousValue = null; }

    try {
      item.name = args.newName;
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setting item.name failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = item.name; } catch (e) { newValue = null; }

    return JSON.stringify({
      ok: true,
      result: {
        nodeId: item.nodeId,
        previousValue: previousValue,
        requestedValue: args.newName,
        newValue: newValue,
        verified: newValue === args.newName
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
