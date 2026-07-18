// Command: set-override-pixel-aspect-ratio → ppb_setOverridePixelAspectRatio
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts set_override_pixel_aspect_ratio
// tool. Item resolution by nodeId/name uses children-presence recursion
// (NOT an isBin() gate), per get-project-item-info.jsx's live-debugged
// finding. previousValue/newValue are read via item.getFootageInterpretation().
// pixelAspectRatio before/after calling
// item.setOverridePixelAspectRatio(numerator, denominator). Undo is
// non-functional on this build — previousValue is the only restoration
// path.

function ppbSetOverridePAR_findByNodeId(item, nodeId, depth) {
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
      var found = ppbSetOverridePAR_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbSetOverridePAR_findByName(item, name, depth) {
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
      var found = ppbSetOverridePAR_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbSetOverridePAR_readPAR(item) {
  try {
    var interp = item.getFootageInterpretation();
    if (interp) {
      return interp.pixelAspectRatio;
    }
  } catch (e) {
    // fall through
  }
  return null;
}

function ppb_setOverridePixelAspectRatio(argsJson) {
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
    if (typeof args.numerator !== "number" || args.numerator <= 0) {
      return JSON.stringify({ ok: false, error: "numerator must be a positive number" });
    }
    if (typeof args.denominator !== "number" || args.denominator <= 0) {
      return JSON.stringify({ ok: false, error: "denominator must be a positive number" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = hasNodeId
      ? ppbSetOverridePAR_findByNodeId(app.project.rootItem, args.nodeId, 0)
      : ppbSetOverridePAR_findByName(app.project.rootItem, args.name, 0);
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var previousValue = ppbSetOverridePAR_readPAR(item);

    try {
      item.setOverridePixelAspectRatio(args.numerator, args.denominator);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setOverridePixelAspectRatio() failed: " + e.toString() });
    }

    var newValue = ppbSetOverridePAR_readPAR(item);
    var requestedRatio = args.numerator / args.denominator;

    return JSON.stringify({
      ok: true,
      result: {
        nodeId: item.nodeId,
        name: item.name,
        previousValue: previousValue,
        requestedNumerator: args.numerator,
        requestedDenominator: args.denominator,
        newValue: newValue,
        verified: newValue !== null && Math.abs(newValue - requestedRatio) < 0.001
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
