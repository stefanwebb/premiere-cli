// Command: refresh-media → ppb_refreshMedia
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts refresh_media tool. Item
// resolution by nodeId/name uses children-presence recursion (NOT an
// isBin() gate), per get-project-item-info.jsx's live-debugged finding.
// item.refreshMedia() has no confirmed getter to detect a real content
// change, so success here only confirms the call didn't throw — the same
// honesty pattern as select-project-item's "called: true" result.

function ppbRefreshMedia_findByNodeId(item, nodeId, depth) {
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
      var found = ppbRefreshMedia_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbRefreshMedia_findByName(item, name, depth) {
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
      var found = ppbRefreshMedia_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppb_refreshMedia(argsJson) {
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
      ? ppbRefreshMedia_findByNodeId(app.project.rootItem, args.nodeId, 0)
      : ppbRefreshMedia_findByName(app.project.rootItem, args.name, 0);
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    try {
      item.refreshMedia();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "refreshMedia() failed: " + e.toString() });
    }

    return JSON.stringify({
      ok: true,
      result: {
        nodeId: item.nodeId,
        name: item.name,
        called: true,
        note: "refreshMedia() has no confirmed getter to detect a content change — this only confirms the call didn't throw"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
