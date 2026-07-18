// Command: set-footage-interpretation → ppb_setFootageInterpretation
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Project-item addressing: at least one of nodeId/name is required (see
// get-item-metadata.jsx for the shared design note — the resolver is
// duplicated per-file since command files load independently).
//
// WRITE command — write-side counterpart of get-footage-interpretation.
// getFootageInterpretation() → mutate given fields → setFootageInterpretation(i)
// → re-get to verify, per PREMIERE_API_NOTES.md. At least one of
// frameRate/pixelAspectRatio/fieldType/alphaUsage is required. Undo is
// NON-FUNCTIONAL on this build — `previousValue` (the full interpretation
// object read before mutating) is the only restoration path.

function ppbFindItemSetFootageInterp_walk(item, args, depth) {
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
      var found = ppbFindItemSetFootageInterp_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemSetFootageInterp_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemSetFootageInterp_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppbSetFootageInterp_snapshot(interp) {
  var snap = {
    alphaUsage: null,
    fieldType: null,
    frameRate: null,
    ignoreAlpha: null,
    invertAlpha: null,
    pixelAspectRatio: null
  };
  try { snap.alphaUsage = interp.alphaUsage; } catch (e) { snap.alphaUsage = null; }
  try { snap.fieldType = interp.fieldType; } catch (e) { snap.fieldType = null; }
  try { snap.frameRate = interp.frameRate; } catch (e) { snap.frameRate = null; }
  try { snap.ignoreAlpha = interp.ignoreAlpha; } catch (e) { snap.ignoreAlpha = null; }
  try { snap.invertAlpha = interp.invertAlpha; } catch (e) { snap.invertAlpha = null; }
  try { snap.pixelAspectRatio = interp.pixelAspectRatio; } catch (e) { snap.pixelAspectRatio = null; }
  return snap;
}

function ppb_setFootageInterpretation(argsJson) {
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

    var hasFrameRate = typeof args.frameRate === "number";
    var hasPixelAspectRatio = typeof args.pixelAspectRatio === "number";
    var hasFieldType = args.fieldType !== undefined && args.fieldType !== null;
    var hasAlphaUsage = args.alphaUsage !== undefined && args.alphaUsage !== null;
    if (!hasFrameRate && !hasPixelAspectRatio && !hasFieldType && !hasAlphaUsage) {
      return JSON.stringify({ ok: false, error: "at least one of frameRate, pixelAspectRatio, fieldType, alphaUsage is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemSetFootageInterp_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    if (typeof item.setFootageInterpretation !== "function") {
      return JSON.stringify({ ok: false, error: "setFootageInterpretation is not available on this Premiere build" });
    }

    var interp = null;
    try {
      interp = item.getFootageInterpretation();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getFootageInterpretation() failed: " + e.toString() });
    }
    if (!interp) {
      return JSON.stringify({ ok: false, error: "no footage interpretation available for this item" });
    }

    var previousValue = ppbSetFootageInterp_snapshot(interp);

    var requestedValue = {};
    if (hasFrameRate) { try { interp.frameRate = args.frameRate; } catch (e) {} requestedValue.frameRate = args.frameRate; }
    if (hasPixelAspectRatio) { try { interp.pixelAspectRatio = args.pixelAspectRatio; } catch (e) {} requestedValue.pixelAspectRatio = args.pixelAspectRatio; }
    if (hasFieldType) { try { interp.fieldType = args.fieldType; } catch (e) {} requestedValue.fieldType = args.fieldType; }
    if (hasAlphaUsage) { try { interp.alphaUsage = args.alphaUsage; } catch (e) {} requestedValue.alphaUsage = args.alphaUsage; }

    try {
      item.setFootageInterpretation(interp);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setFootageInterpretation() failed: " + e.toString() });
    }

    var newInterp = null;
    try {
      newInterp = item.getFootageInterpretation();
    } catch (e) {
      newInterp = null;
    }
    var newValue = newInterp ? ppbSetFootageInterp_snapshot(newInterp) : null;

    var verified = false;
    if (newValue) {
      verified = true;
      if (hasFrameRate && newValue.frameRate !== args.frameRate) { verified = false; }
      if (hasPixelAspectRatio && newValue.pixelAspectRatio !== args.pixelAspectRatio) { verified = false; }
      if (hasFieldType && newValue.fieldType !== args.fieldType) { verified = false; }
      if (hasAlphaUsage && newValue.alphaUsage !== args.alphaUsage) { verified = false; }
    }

    var result = {
      name: null,
      nodeId: null,
      requestedValue: requestedValue,
      previousValue: previousValue,
      newValue: newValue,
      verified: verified
    };
    try { result.name = item.name; } catch (e) { result.name = null; }
    try { result.nodeId = item.nodeId; } catch (e) { result.nodeId = null; }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
