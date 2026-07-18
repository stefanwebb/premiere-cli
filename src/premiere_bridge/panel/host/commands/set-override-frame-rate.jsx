// Command: set-override-frame-rate → ppb_setOverrideFrameRate
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts set_override_frame_rate tool.
// Item resolution by nodeId/name uses children-presence recursion (NOT an
// isBin() gate), per get-project-item-info.jsx's live-debugged finding.
// previousValue/newValue are read via item.getFootageInterpretation().
// frameRate (same field get-footage-interpretation exposes) before/after
// calling item.setOverrideFrameRate(fps). Undo is non-functional on this
// build — previousValue is the only restoration path.

function ppbSetOverrideFrameRate_findByNodeId(item, nodeId, depth) {
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
      var found = ppbSetOverrideFrameRate_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbSetOverrideFrameRate_findByName(item, name, depth) {
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
      var found = ppbSetOverrideFrameRate_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbSetOverrideFrameRate_readFrameRate(item) {
  try {
    var interp = item.getFootageInterpretation();
    if (interp) {
      return interp.frameRate;
    }
  } catch (e) {
    // fall through
  }
  return null;
}

function ppb_setOverrideFrameRate(argsJson) {
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
    if (typeof args.fps !== "number" || args.fps <= 0) {
      return JSON.stringify({ ok: false, error: "fps must be a positive number" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = hasNodeId
      ? ppbSetOverrideFrameRate_findByNodeId(app.project.rootItem, args.nodeId, 0)
      : ppbSetOverrideFrameRate_findByName(app.project.rootItem, args.name, 0);
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var previousValue = ppbSetOverrideFrameRate_readFrameRate(item);

    try {
      item.setOverrideFrameRate(args.fps);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setOverrideFrameRate() failed: " + e.toString() });
    }

    var newValue = ppbSetOverrideFrameRate_readFrameRate(item);

    return JSON.stringify({
      ok: true,
      result: {
        nodeId: item.nodeId,
        name: item.name,
        previousValue: previousValue,
        requestedValue: args.fps,
        newValue: newValue,
        verified: newValue !== null && Math.abs(newValue - args.fps) < 0.001
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
