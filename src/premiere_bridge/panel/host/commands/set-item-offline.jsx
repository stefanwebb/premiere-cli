// Command: set-item-offline → ppb_setItemOffline
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts set_offline tool. Item resolution
// by nodeId/name uses children-presence recursion (NOT an isBin() gate),
// per get-project-item-info.jsx's live-debugged finding. **Destructive-ish**:
// unlinks the item's media (item.setOffline()); undo is non-functional on
// this build, so there is no scripted path back — relink-media is the
// manual recovery path once a new/original file path is known. Verified
// via an isOffline() read-back.

function ppbSetItemOffline_findByNodeId(item, nodeId, depth) {
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
      var found = ppbSetItemOffline_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbSetItemOffline_findByName(item, name, depth) {
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
      var found = ppbSetItemOffline_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppb_setItemOffline(argsJson) {
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

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = hasNodeId
      ? ppbSetItemOffline_findByNodeId(app.project.rootItem, args.nodeId, 0)
      : ppbSetItemOffline_findByName(app.project.rootItem, args.name, 0);
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var previousValue = null;
    try { previousValue = item.isOffline(); } catch (e) { previousValue = null; }

    try {
      item.setOffline();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setOffline() failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = item.isOffline(); } catch (e) { newValue = null; }

    return JSON.stringify({
      ok: true,
      result: {
        nodeId: item.nodeId,
        name: item.name,
        previousValue: previousValue,
        newValue: newValue,
        verified: newValue === true
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
