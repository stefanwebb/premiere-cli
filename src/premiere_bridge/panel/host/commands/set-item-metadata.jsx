// Command: set-item-metadata → ppb_setItemMetadata
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Project-item addressing: at least one of nodeId/name is required (see
// get-item-metadata.jsx for the shared design note — the resolver is
// duplicated per-file since command files load independently).
//
// WRITE command — this is the write-side counterpart of get-item-metadata.
// setProjectMetadata(value, [fieldPath]) replaces the value at one field
// path (e.g. "Column.Intrinsic.Description"); it does NOT touch other
// fields. Undo is NON-FUNCTIONAL on this build — `previousValue` (the
// full metadata blob read before mutating) is the only restoration path
// if a caller needs to revert.

function ppbFindItemSetItemMetadata_walk(item, args, depth) {
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
      var found = ppbFindItemSetItemMetadata_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemSetItemMetadata_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemSetItemMetadata_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_setItemMetadata(argsJson) {
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

    var hasFieldPath = typeof args.fieldPath === "string" && args.fieldPath.length > 0;
    if (!hasFieldPath) {
      return JSON.stringify({ ok: false, error: "fieldPath is required" });
    }
    if (typeof args.value !== "string") {
      return JSON.stringify({ ok: false, error: "value (string) is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemSetItemMetadata_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    if (typeof item.setProjectMetadata !== "function") {
      return JSON.stringify({ ok: false, error: "setProjectMetadata is not available on this Premiere build" });
    }

    var previousValue = null;
    try { previousValue = item.getProjectMetadata(); } catch (e) { previousValue = null; }

    try {
      item.setProjectMetadata(args.value, [args.fieldPath]);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setProjectMetadata() failed: " + e.toString() });
    }

    var newValue = null;
    try { newValue = item.getProjectMetadata(); } catch (e) { newValue = null; }

    var verified = false;
    try {
      verified = typeof newValue === "string" && newValue.indexOf(args.value) !== -1;
    } catch (e) {
      verified = false;
    }

    var result = {
      name: null,
      nodeId: null,
      fieldPath: args.fieldPath,
      requestedValue: args.value,
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
