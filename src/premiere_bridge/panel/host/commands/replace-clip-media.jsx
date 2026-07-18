// Command: replace-clip-media → ppb_replaceClipMedia
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use.
//
// Named after leancoderkavy's premiere-pro-mcp clipboard.ts
// replace_clip_media, but DELIBERATELY implemented differently: that
// reference tool's replace_clip_media is actually just a timeline
// seq.overwriteClip() at a clip's start time with a different project
// item — functionally identical to this panel's own pre-existing
// replace-clip command (host/commands/replace-clip.jsx), which already
// covers that behavior. Porting it again under a new name would just
// duplicate replace-clip.
//
// Instead this command does what its name actually promises — replaces a
// PROJECT ITEM's underlying media FILE via the item-level API
// PREMIERE_API_NOTES.md documents: item.canChangeMediaPath() /
// item.changeMediaPath(newPath, /*overrideChecks*/true). This swaps the
// source file for every clip referencing that project item throughout the
// whole project (not just one timeline clip), which is a materially
// different and more powerful operation than replace-clip's per-clip
// swap.
//
// Destructive-ish: undo is non-functional on this build (see the `undo`
// command's notes) — previousMediaPath is the only path to manually
// revert via a second call.
function ppbFindItemReplaceClipMedia_walk(item, args, depth) {
  if (depth > 32) {
    return null;
  }
  var isBin = false;
  try {
    isBin = typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    isBin = false;
  }
  var matched = false;
  if (args.nodeId !== null) {
    try { matched = item.nodeId === args.nodeId; } catch (e) { matched = false; }
  } else if (args.name !== null) {
    try { matched = item.name === args.name; } catch (e) { matched = false; }
  }
  if (matched) {
    return item;
  }
  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbFindItemReplaceClipMedia_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemReplaceClipMedia_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemReplaceClipMedia_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_replaceClipMedia(argsJson) {
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
      return JSON.stringify({ ok: false, error: "either nodeId or name is required to identify the project item" });
    }
    if (typeof args.newMediaPath !== "string" || !args.newMediaPath) {
      return JSON.stringify({ ok: false, error: "newMediaPath is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemReplaceClipMedia_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var itemName = null;
    var itemNodeId = null;
    try { itemName = item.name; } catch (e2) { itemName = null; }
    try { itemNodeId = item.nodeId; } catch (e3) { itemNodeId = null; }

    var canChange = null;
    try {
      canChange = item.canChangeMediaPath();
    } catch (e4) {
      canChange = null;
    }
    if (canChange === false) {
      return JSON.stringify({ ok: false, error: "item.canChangeMediaPath() returned false — this item's media path cannot be changed", name: itemName, nodeId: itemNodeId });
    }

    var previousMediaPath = null;
    try { previousMediaPath = item.getMediaPath(); } catch (e5) { previousMediaPath = null; }

    try {
      item.changeMediaPath(args.newMediaPath, true);
    } catch (e6) {
      return JSON.stringify({ ok: false, error: "item.changeMediaPath() failed: " + e6.toString(), name: itemName, nodeId: itemNodeId, previousMediaPath: previousMediaPath });
    }

    var newMediaPath = null;
    try { newMediaPath = item.getMediaPath(); } catch (e7) { newMediaPath = null; }

    var verified = newMediaPath !== null && newMediaPath === args.newMediaPath;

    return JSON.stringify({
      ok: true,
      result: {
        name: itemName,
        nodeId: itemNodeId,
        canChangeMediaPath: canChange,
        previousMediaPath: previousMediaPath,
        requestedMediaPath: args.newMediaPath,
        newMediaPath: newMediaPath,
        verified: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
