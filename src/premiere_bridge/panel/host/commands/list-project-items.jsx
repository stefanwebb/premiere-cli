// Command: list-project-items → ppb_listProjectItems
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Recursive depth-first walk of app.project.rootItem.children, descending
// into bins. Helper names are prefixed ppbListProjectItems_ to avoid
// colliding with same-purpose helpers in other lazily-loaded command files
// evaluated into this same global context.

function ppbListProjectItems_typeToString(item) {
  var raw = item.type;
  try {
    if (typeof ProjectItemType !== "undefined") {
      if (raw === ProjectItemType.BIN) {
        return "BIN";
      }
      if (raw === ProjectItemType.CLIP) {
        return "CLIP";
      }
      if (raw === ProjectItemType.FILE) {
        return "FILE";
      }
      if (raw === ProjectItemType.ROOT) {
        return "ROOT";
      }
    }
  } catch (e) {
    // fall through to raw number below
  }
  return String(raw);
}

function ppbListProjectItems_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever.
function ppbListProjectItems_walk(item, parentPath, depth, results) {
  if (depth > 32) {
    return;
  }

  var treePath = null;
  try {
    treePath = item.treePath;
  } catch (e) {
    treePath = null;
  }
  if (!treePath) {
    treePath = parentPath + "/" + item.name;
  }

  var isSequence = null;
  try {
    isSequence = item.isSequence();
  } catch (e) {
    isSequence = null;
  }

  var mediaPath = null;
  try {
    mediaPath = item.getMediaPath();
  } catch (e) {
    mediaPath = null;
  }

  results.push({
    name: item.name,
    treePath: treePath,
    nodeId: item.nodeId,
    type: ppbListProjectItems_typeToString(item),
    isSequence: isSequence,
    mediaPath: mediaPath
  });

  if (ppbListProjectItems_isBin(item) && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbListProjectItems_walk(item.children[i], treePath, depth + 1, results);
    }
  }
}

function ppb_listProjectItems(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var results = [];
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
      ppbListProjectItems_walk(root.children[i], "", 1, results);
    }

    return JSON.stringify({ ok: true, result: { items: results, count: results.length } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
