// Command: detach-proxy → ppb_detachProxy
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts detach_proxy tool. Item
// resolution by nodeId/name uses children-presence recursion (NOT an
// isBin() gate), per get-project-item-info.jsx's live-debugged finding.
// Checks hasProxy() first and fails honestly if no proxy is attached,
// rather than calling detachProxy() unconditionally. Verified via a
// hasProxy() read-back (expected false afterward).

function ppbDetachProxy_findByNodeId(item, nodeId, depth) {
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
      var found = ppbDetachProxy_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbDetachProxy_findByName(item, name, depth) {
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
      var found = ppbDetachProxy_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppb_detachProxy(argsJson) {
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
      ? ppbDetachProxy_findByNodeId(app.project.rootItem, args.nodeId, 0)
      : ppbDetachProxy_findByName(app.project.rootItem, args.name, 0);
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var hadProxy = null;
    try { hadProxy = item.hasProxy(); } catch (e) { hadProxy = null; }
    if (hadProxy === false) {
      return JSON.stringify({
        ok: false,
        error: "hasProxy() returned false — no proxy is attached to this item",
        nodeId: item.nodeId,
        name: item.name
      });
    }

    try {
      item.detachProxy();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "detachProxy() failed: " + e.toString() });
    }

    var hasProxyAfter = null;
    try { hasProxyAfter = item.hasProxy(); } catch (e) { hasProxyAfter = null; }

    return JSON.stringify({
      ok: true,
      result: {
        nodeId: item.nodeId,
        name: item.name,
        hadProxy: hadProxy,
        hasProxyAfter: hasProxyAfter,
        verified: hasProxyAfter === false
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
