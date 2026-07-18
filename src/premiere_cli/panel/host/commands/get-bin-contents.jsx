// Command: get-bin-contents → ppb_getBinContents
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Resolves a bin by a '/'-separated path (same convention as
// create-sequence's --bin) starting at app.project.rootItem, then
// recursively lists its contents (same walk shape as list-project-items.jsx),
// capped at depth 32. Helper names are prefixed ppbBinContents_ to avoid
// colliding with same-purpose helpers in other lazily-loaded command files
// evaluated into this same global context.

function ppbBinContents_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

function ppbBinContents_typeToString(item) {
  try {
    if (typeof ProjectItemType !== "undefined") {
      if (item.type === ProjectItemType.BIN) {
        return "BIN";
      }
      if (item.type === ProjectItemType.CLIP) {
        return "CLIP";
      }
      if (item.type === ProjectItemType.FILE) {
        return "FILE";
      }
      if (item.type === ProjectItemType.ROOT) {
        return "ROOT";
      }
    }
  } catch (e) {
    // fall through to raw number below
  }
  return String(item.type);
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever.
function ppbBinContents_walk(item, parentPath, depth, results) {
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

  var mediaPath = null;
  try {
    mediaPath = item.getMediaPath();
  } catch (e) {
    mediaPath = null;
  }

  var isOffline = null;
  try {
    isOffline = item.isOffline();
  } catch (e) {
    isOffline = null;
  }

  var colorLabel = null;
  try {
    colorLabel = item.getColorLabel();
  } catch (e) {
    colorLabel = null;
  }

  results.push({
    name: item.name,
    treePath: treePath,
    nodeId: item.nodeId,
    type: ppbBinContents_typeToString(item),
    mediaPath: mediaPath,
    isOffline: isOffline,
    colorLabel: colorLabel
  });

  if (ppbBinContents_isBin(item) && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbBinContents_walk(item.children[i], treePath, depth + 1, results);
    }
  }
}

// Resolves a '/'-separated bin path to a bin ProjectItem, starting at
// rootItem. Every path segment must match an existing bin by name — this
// command never creates bins (unlike create-sequence's --bin).
function ppbBinContents_findBin(binPath) {
  var segments = binPath.split("/").filter(function (s) { return s.length > 0; });
  var current = app.project.rootItem;

  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    var found = null;

    for (var j = 0; j < current.children.numItems; j++) {
      var child = current.children[j];
      if (child.name === segment && ppbBinContents_isBin(child)) {
        found = child;
        break;
      }
    }

    if (!found) {
      return null;
    }
    current = found;
  }

  return current;
}

function ppb_getBinContents(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.binPath || typeof args.binPath !== "string") {
      return JSON.stringify({ ok: false, error: "binPath is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var bin = ppbBinContents_findBin(args.binPath);
    if (!bin) {
      return JSON.stringify({ ok: false, error: "no bin found at path \"" + args.binPath + "\"" });
    }
    if (!ppbBinContents_isBin(bin)) {
      return JSON.stringify({ ok: false, error: "\"" + args.binPath + "\" is not a bin" });
    }

    var results = [];
    for (var i = 0; i < bin.children.numItems; i++) {
      ppbBinContents_walk(bin.children[i], bin.treePath || args.binPath, 1, results);
    }

    var binTreePath = null;
    try {
      binTreePath = bin.treePath;
    } catch (e) {
      binTreePath = args.binPath;
    }

    return JSON.stringify({
      ok: true,
      result: {
        binPath: args.binPath,
        binNodeId: bin.nodeId,
        binTreePath: binTreePath,
        items: results,
        count: results.length
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
