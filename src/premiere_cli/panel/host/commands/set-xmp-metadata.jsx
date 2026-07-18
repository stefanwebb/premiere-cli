// Command: set-xmp-metadata → ppb_setXmpMetadata
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Project-item addressing: at least one of nodeId/name is required (see
// get-item-metadata.jsx for the shared design note — the resolver is
// duplicated per-file since command files load independently).
//
// WRITE command — write-side counterpart of get-xmp-metadata.
// setXMPMetadata(xml) REPLACES THE ITEM'S ENTIRE XMP BLOCK — it is not a
// merge/patch. Callers should run get-xmp-metadata first, modify the
// returned XML, and pass the full result back here. XMP blobs are too
// large for a command line, so this command's `xmp` wire arg is expected
// to already be file contents — the CLI's --xmp-file flag reads a local
// file and sends it, all in Python; this file never touches the
// filesystem. Undo is NON-FUNCTIONAL on this build — `previousValue`
// (truncated to 100KB, same as get-xmp-metadata) is the only restoration
// path.

var PPB_SET_XMP_METADATA_MAX_CHARS = 102400;

function ppbFindItemSetXmpMetadata_walk(item, args, depth) {
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
      var found = ppbFindItemSetXmpMetadata_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemSetXmpMetadata_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemSetXmpMetadata_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppbSetXmpMetadata_truncate(xmp) {
  var truncated = false;
  if (typeof xmp === "string" && xmp.length > PPB_SET_XMP_METADATA_MAX_CHARS) {
    xmp = xmp.substring(0, PPB_SET_XMP_METADATA_MAX_CHARS);
    truncated = true;
  }
  return { value: xmp, truncated: truncated };
}

function ppb_setXmpMetadata(argsJson) {
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

    if (typeof args.xmp !== "string" || args.xmp.length === 0) {
      return JSON.stringify({ ok: false, error: "xmp (non-empty string) is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemSetXmpMetadata_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    if (typeof item.setXMPMetadata !== "function") {
      return JSON.stringify({ ok: false, error: "setXMPMetadata is not available on this Premiere build" });
    }

    var previousRaw = null;
    try { previousRaw = item.getXMPMetadata(); } catch (e) { previousRaw = null; }
    var previousTruncation = ppbSetXmpMetadata_truncate(previousRaw);

    try {
      item.setXMPMetadata(args.xmp);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setXMPMetadata() failed: " + e.toString() });
    }

    var newRaw = null;
    try { newRaw = item.getXMPMetadata(); } catch (e) { newRaw = null; }
    var newTruncation = ppbSetXmpMetadata_truncate(newRaw);

    var verified = false;
    var note = null;
    if (typeof newRaw === "string") {
      if (!newTruncation.truncated && !(args.xmp.length > PPB_SET_XMP_METADATA_MAX_CHARS)) {
        verified = newRaw === args.xmp;
      } else {
        // Either the requested XMP or the read-back was too large to
        // compare in full — only the truncated prefixes can be checked.
        verified = newTruncation.value === args.xmp.substring(0, PPB_SET_XMP_METADATA_MAX_CHARS);
        note = "requested value and/or read-back exceeded 100KB — verified against truncated prefixes only";
      }
    }

    var result = {
      name: null,
      nodeId: null,
      requestedValue: args.xmp,
      previousValue: previousTruncation.value,
      previousTruncated: previousTruncation.truncated,
      newValue: newTruncation.value,
      truncated: newTruncation.truncated,
      verified: verified
    };
    if (note) {
      result.note = note;
    }
    try { result.name = item.name; } catch (e) { result.name = null; }
    try { result.nodeId = item.nodeId; } catch (e) { result.nodeId = null; }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
