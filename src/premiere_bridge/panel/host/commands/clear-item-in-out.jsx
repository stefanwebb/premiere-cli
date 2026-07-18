// Command: clear-item-in-out → ppb_clearItemInOut
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's track-targeting.ts
// clear_item_in_out — clears in and/or out points on a PROJECT item via
// item.clearInPoint()/clearOutPoint(), resetting it to its full source
// duration. Both default to true (clear both) unless explicitly set false.
//
// Project-item addressing/lookup duplicated per command file, same
// convention as get-item-metadata.jsx / set-item-in-out.jsx.

function ppbFindItemClearItemInOut_walk(item, args, depth) {
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
      var found = ppbFindItemClearItemInOut_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemClearItemInOut_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemClearItemInOut_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_clearItemInOut(argsJson) {
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

    var item = ppbFindItemClearItemInOut_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var clearIn = args.clearIn !== false;
    var clearOut = args.clearOut !== false;

    var inClearError = null;
    var outClearError = null;

    if (clearIn) {
      try {
        item.clearInPoint();
      } catch (e) {
        inClearError = e.toString();
      }
    }
    if (clearOut) {
      try {
        item.clearOutPoint();
      } catch (e) {
        outClearError = e.toString();
      }
    }

    return JSON.stringify({
      ok: (clearIn ? inClearError === null : true) && (clearOut ? outClearError === null : true),
      result: {
        name: item.name,
        nodeId: item.nodeId,
        clearedIn: clearIn && inClearError === null,
        clearedOut: clearOut && outClearError === null,
        inClearError: inClearError,
        outClearError: outClearError,
        note: "no getInPoint/getOutPoint-style getter is confirmed available on this build (see set-item-in-out.jsx) — this only confirms the clear call(s) did not throw"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
