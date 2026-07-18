// Command: get-duplicate-media → ppb_getDuplicateMedia
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Recursive walk of app.project.rootItem.children (same shape as
// list-project-items.jsx), grouping non-bin items by mediaPath and
// reporting groups with more than one member. Helper names are prefixed
// ppbDuplicateMedia_ to avoid colliding with same-purpose helpers in other
// lazily-loaded command files evaluated into this same global context.

function ppbDuplicateMedia_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever.
function ppbDuplicateMedia_scan(item, depth, pathMap, order) {
  if (depth > 32) {
    return;
  }

  var mediaPath = null;
  try {
    mediaPath = item.getMediaPath();
  } catch (e) {
    mediaPath = null;
  }

  if (mediaPath) {
    if (!pathMap[mediaPath]) {
      pathMap[mediaPath] = [];
      order.push(mediaPath);
    }
    var entry = { nodeId: null, name: null, treePath: null };
    try { entry.nodeId = item.nodeId; } catch (e) { entry.nodeId = null; }
    try { entry.name = item.name; } catch (e) { entry.name = null; }
    try { entry.treePath = item.treePath; } catch (e) { entry.treePath = null; }
    pathMap[mediaPath].push(entry);
  }

  if (ppbDuplicateMedia_isBin(item) && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbDuplicateMedia_scan(item.children[i], depth + 1, pathMap, order);
    }
  }
}

function ppb_getDuplicateMedia(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var pathMap = {};
    var order = [];
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
      ppbDuplicateMedia_scan(root.children[i], 1, pathMap, order);
    }

    var duplicates = [];
    for (var j = 0; j < order.length; j++) {
      var path = order[j];
      if (pathMap[path].length > 1) {
        duplicates.push({ mediaPath: path, count: pathMap[path].length, items: pathMap[path] });
      }
    }

    return JSON.stringify({ ok: true, result: { duplicateGroupCount: duplicates.length, duplicates: duplicates } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
