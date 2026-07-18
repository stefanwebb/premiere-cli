// Command: search-project-items → ppb_searchProjectItems
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Recursive walk of the whole project item tree (same shape as
// list-project-items.jsx's walk), skipping bins for matching purposes but
// always recursing through them. A matching item must satisfy ALL given
// filters. Helper names are prefixed ppbSearchItems_ to avoid colliding
// with same-purpose helpers in other lazily-loaded command files
// evaluated into this same global context.

function ppbSearchItems_extOf(mediaPath) {
  if (!mediaPath || typeof mediaPath !== "string") {
    return null;
  }
  var dot = mediaPath.lastIndexOf(".");
  if (dot === -1 || dot === mediaPath.length - 1) {
    return null;
  }
  return mediaPath.substring(dot + 1).toLowerCase();
}

function ppbSearchItems_normalizeExtFilter(extension) {
  var e = extension.toLowerCase();
  if (e.charAt(0) === ".") {
    e = e.substring(1);
  }
  return e;
}

function ppbSearchItems_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever. errorHolder.error is set (and
// the walk aborted) only when a colorLabel filter was requested AND
// getColorLabel() isn't available on this Premiere build.
function ppbSearchItems_walk(item, parentPath, depth, filters, results, errorHolder) {
  if (depth > 32 || errorHolder.error) {
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

  var isBin = ppbSearchItems_isBin(item);

  if (!isBin) {
    var mediaPath = null;
    try {
      mediaPath = item.getMediaPath();
    } catch (e) {
      mediaPath = null;
    }

    var isOffline = false;
    try {
      isOffline = item.isOffline();
    } catch (e) {
      isOffline = false;
    }

    var colorLabel = null;
    var colorLabelAvailable = true;
    try {
      colorLabel = item.getColorLabel();
    } catch (e) {
      colorLabelAvailable = false;
      colorLabel = null;
    }

    if (filters.colorLabel !== null && !colorLabelAvailable) {
      errorHolder.error = "getColorLabel is not available on this Premiere build";
      return;
    }

    var matches = true;

    if (filters.nameContains !== null && item.name.toLowerCase().indexOf(filters.nameContains) === -1) {
      matches = false;
    }

    if (matches && filters.extension !== null) {
      var ext = ppbSearchItems_extOf(mediaPath);
      if (ext !== filters.extension) {
        matches = false;
      }
    }

    if (matches && filters.offlineOnly === true && !isOffline) {
      matches = false;
    }

    if (matches && filters.colorLabel !== null && colorLabel !== filters.colorLabel) {
      matches = false;
    }

    if (matches) {
      results.push({
        name: item.name,
        treePath: treePath,
        nodeId: item.nodeId,
        mediaPath: mediaPath,
        isOffline: isOffline,
        colorLabel: colorLabel
      });
    }
  }

  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbSearchItems_walk(item.children[i], treePath, depth + 1, filters, results, errorHolder);
      if (errorHolder.error) {
        return;
      }
    }
  }
}

function ppb_searchProjectItems(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasNameContains = typeof args.nameContains === "string" && args.nameContains.length > 0;
    var hasExtension = typeof args.extension === "string" && args.extension.length > 0;
    var hasOfflineOnly = args.offlineOnly === true;
    var hasColorLabel = typeof args.colorLabel === "number";

    if (!hasNameContains && !hasExtension && !hasOfflineOnly && !hasColorLabel) {
      return JSON.stringify({ ok: false, error: "at least one filter is required (nameContains, extension, offlineOnly, colorLabel)" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var filters = {
      nameContains: hasNameContains ? args.nameContains.toLowerCase() : null,
      extension: hasExtension ? ppbSearchItems_normalizeExtFilter(args.extension) : null,
      offlineOnly: hasOfflineOnly,
      colorLabel: hasColorLabel ? args.colorLabel : null
    };

    var results = [];
    var errorHolder = { error: null };
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
      ppbSearchItems_walk(root.children[i], "", 1, filters, results, errorHolder);
      if (errorHolder.error) {
        break;
      }
    }

    if (errorHolder.error) {
      return JSON.stringify({ ok: false, error: errorHolder.error });
    }

    return JSON.stringify({ ok: true, result: { items: results, count: results.length } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
