// Command: encode-project-item → ppb_encodeProjectItem
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Queues a PROJECT ITEM (not a sequence) for export in Adobe Media Encoder
// via app.encoder.launchEncoder() + encodeProjectItem() + startBatch(),
// mirroring the reference tool this ports (leancoderkavy's
// premiere-pro-mcp encode_project_item). **Fire-and-forget** — same no-
// progress-API caveat as add-to-render-queue: encodeProjectItem() returns
// as soon as the job is queued, so this command cannot verify the output
// file exists.

// Project-item addressing (nodeId or name) — duplicated per command file
// since each loads independently; same walk as get-item-metadata.jsx's
// ppbFindItemGetItemMetadata_* helpers, prefixed for this file.
function ppbFindItemEncodeProjectItem_walk(item, args, depth) {
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
      var found = ppbFindItemEncodeProjectItem_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemEncodeProjectItem_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemEncodeProjectItem_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_encodeProjectItem(argsJson) {
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
      return JSON.stringify({ ok: false, error: "either nodeId or name is required to address the project item" });
    }
    if (!args.outputPath || typeof args.outputPath !== "string") {
      return JSON.stringify({ ok: false, error: "outputPath is required" });
    }
    if (!args.presetPath || typeof args.presetPath !== "string") {
      return JSON.stringify({ ok: false, error: "presetPath is required (an absolute .epr file path)" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemEncodeProjectItem_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var presetFile = new File(args.presetPath);
    if (!presetFile.exists) {
      return JSON.stringify({ ok: false, error: "preset file not found: " + args.presetPath });
    }

    var startBatch = args.startBatch === true;

    if (!app.encoder) {
      return JSON.stringify({ ok: false, error: "Adobe Media Encoder is not available (app.encoder is undefined)" });
    }

    try {
      app.encoder.launchEncoder();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.encoder.launchEncoder() failed: " + e.toString() });
    }

    var itemName = null;
    try { itemName = item.name; } catch (e) { itemName = null; }

    try {
      app.encoder.encodeProjectItem(
        item,
        args.outputPath,
        args.presetPath,
        typeof app.encoder.ENCODE_IN_TO_OUT !== "undefined" ? app.encoder.ENCODE_IN_TO_OUT : 1,
        1 /* removeOnCompletion */
      );
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.encoder.encodeProjectItem() failed: " + e.toString() });
    }

    if (startBatch) {
      try {
        app.encoder.startBatch();
      } catch (e) {
        return JSON.stringify({ ok: false, error: "job was queued but app.encoder.startBatch() failed: " + e.toString() });
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        item: itemName,
        nodeId: hasNodeId ? args.nodeId : (item.nodeId || null),
        outputPath: args.outputPath,
        presetPath: args.presetPath,
        startBatch: startBatch,
        note: "fire-and-forget: the job is queued in Adobe Media Encoder, not exported synchronously — " +
          "there is no progress API, so this result does NOT confirm the output file exists yet."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
