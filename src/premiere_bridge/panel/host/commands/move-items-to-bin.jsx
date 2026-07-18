// Command: move-items-to-bin → ppb_moveItemsToBin
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// MERGES the reference project's two near-duplicate media.ts/track-
// targeting.ts tools — move_item_to_bin (single item) and
// move_items_to_bin (array) — into one command: pass either nodeIds (a
// JSON array string) OR a single nodeId/name, plus targetBinPath. Item
// resolution uses children-presence recursion (NOT an isBin() gate) per
// get-project-item-info.jsx's live-debugged finding that the ROOT item's
// type is ROOT, not BIN — an isBin() gate would never descend past the
// root. targetBinPath is a '/'-separated bin path (same convention as
// create-sequence's bin arg) resolved but never auto-created here — call
// create-bin first if it might not exist. Each move verified by re-reading
// the item's own treePath afterward and confirming it now starts with the
// target bin's treePath.

function ppbMoveItemsToBin_findByNodeId(item, nodeId, depth) {
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
      var found = ppbMoveItemsToBin_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbMoveItemsToBin_findByName(item, name, depth) {
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
      var found = ppbMoveItemsToBin_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbMoveItemsToBin_resolveBinPath(binPath) {
  var segments = binPath.split("/").filter(function (s) { return s.length > 0; });
  if (segments.length === 0) {
    return { error: "targetBinPath must contain at least one non-empty segment" };
  }
  var current = app.project.rootItem;
  for (var i = 0; i < segments.length; i++) {
    var found = null;
    for (var j = 0; j < current.children.numItems; j++) {
      var child = current.children[j];
      if (child.name === segments[i] && typeof ProjectItemType !== "undefined" && child.type === ProjectItemType.BIN) {
        found = child;
        break;
      }
    }
    if (!found) {
      return { error: "bin path segment \"" + segments[i] + "\" not found in \"" + binPath + "\" (target bin must already exist — call create-bin first)" };
    }
    current = found;
  }
  return { bin: current };
}

function ppb_moveItemsToBin(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var identifiers = [];
    if (typeof args.nodeIds === "string" && args.nodeIds.length > 0) {
      var parsed;
      try {
        parsed = JSON.parse(args.nodeIds);
      } catch (e) {
        return JSON.stringify({ ok: false, error: "nodeIds must be a JSON array string: " + e.toString() });
      }
      if (!(parsed instanceof Array)) {
        return JSON.stringify({ ok: false, error: "nodeIds must parse to a JSON array" });
      }
      for (var i = 0; i < parsed.length; i++) {
        identifiers.push({ nodeId: parsed[i], name: null });
      }
    } else if (typeof args.nodeId === "string" && args.nodeId.length > 0) {
      identifiers.push({ nodeId: args.nodeId, name: null });
    } else if (typeof args.name === "string" && args.name.length > 0) {
      identifiers.push({ nodeId: null, name: args.name });
    }

    if (identifiers.length === 0) {
      return JSON.stringify({ ok: false, error: "one of nodeIds (JSON array), nodeId, or name is required" });
    }

    if (!args.targetBinPath || typeof args.targetBinPath !== "string") {
      return JSON.stringify({ ok: false, error: "targetBinPath is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var binResolved = ppbMoveItemsToBin_resolveBinPath(args.targetBinPath);
    if (binResolved.error) {
      return JSON.stringify({ ok: false, error: binResolved.error });
    }
    var targetBin = binResolved.bin;
    var targetTreePath = null;
    try { targetTreePath = targetBin.treePath; } catch (e) { targetTreePath = null; }

    var results = [];
    var movedCount = 0;

    for (var k = 0; k < identifiers.length; k++) {
      var ident = identifiers[k];
      var item = ident.nodeId
        ? ppbMoveItemsToBin_findByNodeId(app.project.rootItem, ident.nodeId, 0)
        : ppbMoveItemsToBin_findByName(app.project.rootItem, ident.name, 0);

      if (!item) {
        results.push({
          nodeId: ident.nodeId,
          name: ident.name,
          moved: false,
          error: "no project item found matching the given nodeId/name"
        });
        continue;
      }

      var itemName = null;
      try { itemName = item.name; } catch (e) { itemName = null; }
      var itemNodeId = null;
      try { itemNodeId = item.nodeId; } catch (e) { itemNodeId = null; }

      try {
        item.moveBin(targetBin);
      } catch (e) {
        results.push({ nodeId: itemNodeId, name: itemName, moved: false, error: "moveBin() failed: " + e.toString() });
        continue;
      }

      var newTreePath = null;
      try { newTreePath = item.treePath; } catch (e) { newTreePath = null; }
      var verified = targetTreePath !== null && newTreePath !== null && newTreePath.indexOf(targetTreePath) === 0;

      results.push({
        nodeId: itemNodeId,
        name: itemName,
        moved: true,
        newTreePath: newTreePath,
        verified: verified
      });
      if (verified) {
        movedCount++;
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        targetBinPath: args.targetBinPath,
        requestedCount: identifiers.length,
        movedCount: movedCount,
        results: results
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
