// Command: get-all-project-paths → ppb_getAllProjectPaths
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Recursive walk of app.project.rootItem.children (same shape as
// list-project-items.jsx), collecting every unique non-null mediaPath.
// Helper names are prefixed ppbAllProjectPaths_ to avoid colliding with
// same-purpose helpers in other lazily-loaded command files evaluated into
// this same global context.

function ppbAllProjectPaths_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever.
function ppbAllProjectPaths_scan(item, depth, pathMap, order) {
  if (depth > 32) {
    return;
  }

  var mediaPath = null;
  try {
    mediaPath = item.getMediaPath();
  } catch (e) {
    mediaPath = null;
  }

  if (mediaPath && !pathMap[mediaPath]) {
    var entry = { path: mediaPath, name: null, nodeId: null, offline: null };
    try { entry.name = item.name; } catch (e) { entry.name = null; }
    try { entry.nodeId = item.nodeId; } catch (e) { entry.nodeId = null; }
    try { entry.offline = item.isOffline(); } catch (e) { entry.offline = null; }
    pathMap[mediaPath] = entry;
    order.push(mediaPath);
  }

  if (ppbAllProjectPaths_isBin(item) && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbAllProjectPaths_scan(item.children[i], depth + 1, pathMap, order);
    }
  }
}

function ppb_getAllProjectPaths(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var pathMap = {};
    var order = [];
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
      ppbAllProjectPaths_scan(root.children[i], 1, pathMap, order);
    }

    var paths = [];
    for (var j = 0; j < order.length; j++) {
      paths.push(pathMap[order[j]]);
    }

    return JSON.stringify({ ok: true, result: { pathCount: paths.length, paths: paths } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
