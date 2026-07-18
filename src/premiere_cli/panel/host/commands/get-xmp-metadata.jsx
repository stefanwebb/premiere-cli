// Command: get-xmp-metadata → ppb_getXmpMetadata
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Project-item addressing: at least one of nodeId/name is required (see
// get-item-metadata.jsx for the shared design note — the resolver is
// duplicated per-file since command files load independently).
//
// XMP metadata can be a large XML blob — truncated to 100KB (102400
// chars) with a `truncated` flag so callers aren't surprised by a huge
// response.

var PPB_XMP_METADATA_MAX_CHARS = 102400;

function ppbFindItemGetXmpMetadata_walk(item, args, depth) {
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
      var found = ppbFindItemGetXmpMetadata_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemGetXmpMetadata_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemGetXmpMetadata_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_getXmpMetadata(argsJson) {
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

    var item = ppbFindItemGetXmpMetadata_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var xmp = null;
    try {
      xmp = item.getXMPMetadata();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getXMPMetadata() failed: " + e.toString() });
    }

    var truncated = false;
    if (typeof xmp === "string" && xmp.length > PPB_XMP_METADATA_MAX_CHARS) {
      xmp = xmp.substring(0, PPB_XMP_METADATA_MAX_CHARS);
      truncated = true;
    }

    var result = { name: null, nodeId: null, xmpMetadata: xmp, truncated: truncated };
    try { result.name = item.name; } catch (e) { result.name = null; }
    try { result.nodeId = item.nodeId; } catch (e) { result.nodeId = null; }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
