// Command: relink-media → ppb_relinkMedia
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts relink_media tool. Item
// resolution by nodeId/name uses children-presence recursion (NOT an
// isBin() gate), per get-project-item-info.jsx's live-debugged finding
// that the ROOT item's type is ROOT, not BIN. Checks canChangeMediaPath()
// first, then calls item.changeMediaPath(newPath, true) per
// PREMIERE_API_NOTES.md, verified via a getMediaPath() read-back against
// the requested path.

function ppbRelinkMedia_findByNodeId(item, nodeId, depth) {
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
      var found = ppbRelinkMedia_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbRelinkMedia_findByName(item, name, depth) {
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
      var found = ppbRelinkMedia_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbRelinkMedia_resolveItem(args) {
  if (args.nodeId) {
    return ppbRelinkMedia_findByNodeId(app.project.rootItem, args.nodeId, 0);
  }
  return ppbRelinkMedia_findByName(app.project.rootItem, args.name, 0);
}

function ppb_relinkMedia(argsJson) {
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
    if (!args.newPath || typeof args.newPath !== "string") {
      return JSON.stringify({ ok: false, error: "newPath is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbRelinkMedia_resolveItem({ nodeId: hasNodeId ? args.nodeId : null, name: hasNodeId ? null : args.name });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var canChange = null;
    try { canChange = item.canChangeMediaPath(); } catch (e) { canChange = null; }
    if (canChange === false) {
      return JSON.stringify({
        ok: false,
        error: "canChangeMediaPath() returned false — this item's media path cannot be changed",
        nodeId: item.nodeId,
        name: item.name
      });
    }

    var previousValue = null;
    try { previousValue = item.getMediaPath(); } catch (e) { previousValue = null; }

    var callResult = null;
    try {
      callResult = item.changeMediaPath(args.newPath, true);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "changeMediaPath() failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = item.getMediaPath(); } catch (e) { newValue = null; }

    return JSON.stringify({
      ok: true,
      result: {
        nodeId: item.nodeId,
        name: item.name,
        canChangeMediaPath: canChange,
        callResult: callResult,
        previousValue: previousValue,
        requestedValue: args.newPath,
        newValue: newValue,
        verified: newValue === args.newPath
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
