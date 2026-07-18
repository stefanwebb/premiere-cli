// Command: find-items-by-media-path → ppb_findItemsByMediaPath
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// READ-only. Ported from leancoderkavy/premiere-pro-mcp's project.ts
// find_items_by_media_path. Primary path: rootItem.findItemsMatchingMediaPath
// (PREMIERE_API_NOTES.md's Project/bins/import section). Some builds may
// not expose it, or it may not substring-match reliably — a manual
// depth-first bin walk comparing getMediaPath() is used as a fallback (and
// to cross-check), same walk shape as list-project-items.jsx. Helper names
// prefixed ppbFindByMediaPath_ to avoid colliding with same-purpose
// helpers in other lazily-loaded command files evaluated into this same
// global context.

function ppbFindByMediaPath_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

function ppbFindByMediaPath_walk(item, pathContains, depth, results, seenNodeIds) {
  if (depth > 32) {
    return;
  }

  if (!ppbFindByMediaPath_isBin(item)) {
    var mediaPath = null;
    try { mediaPath = item.getMediaPath(); } catch (e) { mediaPath = null; }

    if (mediaPath && mediaPath.toLowerCase().indexOf(pathContains.toLowerCase()) !== -1) {
      var nodeId = null;
      try { nodeId = item.nodeId; } catch (e) { nodeId = null; }
      if (!nodeId || !seenNodeIds[nodeId]) {
        if (nodeId) { seenNodeIds[nodeId] = true; }
        var treePath = null;
        try { treePath = item.treePath; } catch (e) { treePath = null; }
        results.push({ name: item.name, treePath: treePath, nodeId: nodeId, mediaPath: mediaPath });
      }
    }
  }

  if (ppbFindByMediaPath_isBin(item) && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbFindByMediaPath_walk(item.children[i], pathContains, depth + 1, results, seenNodeIds);
    }
  }
}

function ppb_findItemsByMediaPath(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.pathContains || typeof args.pathContains !== "string") {
      return JSON.stringify({ ok: false, error: "pathContains is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var method = null;
    var items = [];
    var seenNodeIds = {};

    var root = app.project.rootItem;
    if (typeof root.findItemsMatchingMediaPath === "function") {
      try {
        var matches = root.findItemsMatchingMediaPath(args.pathContains);
        if (matches) {
          method = "findItemsMatchingMediaPath";
          for (var i = 0; i < matches.length; i++) {
            var m = matches[i];
            var nodeId = null;
            var treePath = null;
            var mediaPath = null;
            try { nodeId = m.nodeId; } catch (e) { nodeId = null; }
            try { treePath = m.treePath; } catch (e) { treePath = null; }
            try { mediaPath = m.getMediaPath(); } catch (e) { mediaPath = null; }
            if (!nodeId || !seenNodeIds[nodeId]) {
              if (nodeId) { seenNodeIds[nodeId] = true; }
              items.push({ name: m.name, treePath: treePath, nodeId: nodeId, mediaPath: mediaPath });
            }
          }
        }
      } catch (e) {
        // fall through to manual walk below
      }
    }

    if (method === null) {
      method = "manualWalk";
      for (var j = 0; j < root.children.numItems; j++) {
        ppbFindByMediaPath_walk(root.children[j], args.pathContains, 1, items, seenNodeIds);
      }
    }

    return JSON.stringify({
      ok: true,
      result: { pathContains: args.pathContains, method: method, items: items, count: items.length }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
