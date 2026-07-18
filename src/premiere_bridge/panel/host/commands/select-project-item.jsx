// Command: select-project-item → ppb_selectProjectItem
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy's premiere-pro-mcp select_item tool (renamed
// select-project-item here for clarity, since this panel already has
// several clip/track "select" concepts and this one is specifically the
// Project panel). Project-item addressing matches get-item-metadata.jsx
// (nodeId/name, depth-first bin walk, duplicated locally per this panel's
// convention). The reference calls item.select() directly with no
// verification at all — no confirmed "read current Project-panel
// selection" API exists anywhere in PREMIERE_API_NOTES.md (the documented
// seq.getSelection() is for TIMELINE selection, a different thing).
//
// MUTATION RULE / HONESTY NOTE: item.select() is called and any exception
// is surfaced as a failure. There is deliberately NO claim of a confirmed
// state change beyond "the call did not throw" — this is reported
// explicitly in the result rather than glossed over, per this wave's
// mutation rules (verify where feasible; where nothing is feasible, say
// so).

function ppbSelectProjectItem_walk(item, args, depth) {
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
      var found = ppbSelectProjectItem_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbSelectProjectItem_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbSelectProjectItem_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_selectProjectItem(argsJson) {
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

    var item = ppbSelectProjectItem_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    if (typeof item.select !== "function") {
      return JSON.stringify({ ok: false, error: "item.select() is not available on this Premiere build for this item" });
    }

    try {
      item.select();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "item.select() failed: " + e.toString() });
    }

    return JSON.stringify({
      ok: true,
      result: {
        item: (function () { try { return item.name; } catch (e) { return null; } })(),
        nodeId: (function () { try { return item.nodeId; } catch (e) { return null; } })(),
        called: true,
        note: "no confirmed Project-panel-selection read-back API exists (seq.getSelection() is timeline-only) — this only reports that item.select() did not throw, not an independently verified selection state"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
