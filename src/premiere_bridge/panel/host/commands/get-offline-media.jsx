// Command: get-offline-media → ppb_getOfflineMedia
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Recursive walk of app.project.rootItem.children (same shape as
// list-project-items.jsx), collecting every item where isOffline() is
// true. Helper names are prefixed ppbOfflineMedia_ to avoid colliding with
// same-purpose helpers in other lazily-loaded command files evaluated into
// this same global context.

function ppbOfflineMedia_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever.
function ppbOfflineMedia_scan(item, depth, results) {
  if (depth > 32) {
    return;
  }

  var isOffline = false;
  try {
    isOffline = item.isOffline();
  } catch (e) {
    isOffline = false;
  }

  if (isOffline) {
    var entry = { nodeId: null, name: null, treePath: null, mediaPath: null, colorLabel: null };
    try { entry.nodeId = item.nodeId; } catch (e) { entry.nodeId = null; }
    try { entry.name = item.name; } catch (e) { entry.name = null; }
    try { entry.treePath = item.treePath; } catch (e) { entry.treePath = null; }
    try { entry.mediaPath = item.getMediaPath(); } catch (e) { entry.mediaPath = null; }
    try { entry.colorLabel = item.getColorLabel(); } catch (e) { entry.colorLabel = null; }
    results.push(entry);
  }

  if (ppbOfflineMedia_isBin(item) && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbOfflineMedia_scan(item.children[i], depth + 1, results);
    }
  }
}

function ppb_getOfflineMedia(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var results = [];
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
      ppbOfflineMedia_scan(root.children[i], 1, results);
    }

    return JSON.stringify({ ok: true, result: { offlineCount: results.length, items: results } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
