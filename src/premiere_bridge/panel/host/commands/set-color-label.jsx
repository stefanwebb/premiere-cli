// Command: set-color-label → ppb_setColorLabel
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Project-item addressing: at least one of nodeId/name is required (see
// get-item-metadata.jsx for the shared design note — the resolver is
// duplicated per-file since command files load independently).
//
// WRITE command — write-side counterpart of get-color-label. Undo is
// NON-FUNCTIONAL on this build — `previousValue` is the only restoration
// path. get-color-label degrades honestly when getColorLabel is absent
// on a build; this command mirrors that for both the getter (used for
// previousValue/newValue) and the setter itself.

function ppbFindItemSetColorLabel_walk(item, args, depth) {
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
      var found = ppbFindItemSetColorLabel_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemSetColorLabel_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemSetColorLabel_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_setColorLabel(argsJson) {
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

    if (typeof args.colorLabel !== "number" || args.colorLabel < 0 || args.colorLabel > 15) {
      return JSON.stringify({ ok: false, error: "colorLabel (integer 0-15) is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemSetColorLabel_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    if (typeof item.setColorLabel !== "function") {
      return JSON.stringify({ ok: false, error: "setColorLabel is not available on this Premiere build" });
    }

    var previousValue = null;
    try { previousValue = item.getColorLabel(); } catch (e) { previousValue = null; }

    try {
      item.setColorLabel(args.colorLabel);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setColorLabel() failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = item.getColorLabel(); } catch (e) { newValue = null; }

    var verified = newValue !== null && newValue === args.colorLabel;

    var result = {
      name: null,
      nodeId: null,
      previousValue: previousValue,
      requestedValue: args.colorLabel,
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
