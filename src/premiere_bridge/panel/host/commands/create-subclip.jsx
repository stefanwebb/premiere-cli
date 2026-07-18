// Command: create-subclip → ppb_createSubclip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Creates a subclip from a project item's in/out range via
// item.createSubClip(name, inTicks, outTicks, hardBounds01, takeVideo01,
// takeAudio01) (PREMIERE_API_NOTES.md line 280). Trailing-arg order is
// DISPUTED across the reference repos this panel ports from — some place
// takeVideo/takeAudio before hardBounds, some after — so a short list of
// plausible argument orders is tried in turn (an "attempts" array, same
// spirit as export-frame's exportFramePNG guessing), each judged ONLY by
// whether a genuinely NEW project item shows up afterward: nodeIds present
// in the project tree are snapshotted before the call and diffed against a
// fresh walk after, since createSubClip()'s own return value cannot be
// trusted any more than exportFramePNG's could.

// Project-item addressing (nodeId or name) — duplicated per command file,
// same walk as get-item-metadata.jsx's ppbFindItemGetItemMetadata_*
// helpers, prefixed for this file.
function ppbFindItemCreateSubclip_walk(item, args, depth) {
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
      var found = ppbFindItemCreateSubclip_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemCreateSubclip_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemCreateSubclip_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

// Collects every nodeId currently in the project's bin tree (depth-capped
// at 32, same as the item resolver above) — used to diff before/after a
// createSubClip() call, since the call's own return value isn't trusted.
function ppbCreateSubclip_collectNodeIds(item, out, depth) {
  if (depth > 32) {
    return;
  }
  var isBin = false;
  try {
    isBin = typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    isBin = false;
  }
  var nodeId = null;
  try { nodeId = item.nodeId; } catch (e) { nodeId = null; }
  if (nodeId) {
    out[nodeId] = true;
  }
  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbCreateSubclip_collectNodeIds(item.children[i], out, depth + 1);
    }
  }
}

function ppbCreateSubclip_snapshotNodeIds() {
  var out = {};
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    ppbCreateSubclip_collectNodeIds(root.children[i], out, 1);
  }
  return out;
}

// Finds a project item whose nodeId is present now but wasn't in `before`,
// and whose name matches the requested subclip name (createSubClip() often
// creates the new item right alongside the source, so a plain name match
// on the diff is the most reliable identification available).
function ppbCreateSubclip_findNewItem(before, requestedName) {
  var found = null;
  function walk(item, depth) {
    if (found || depth > 32) {
      return;
    }
    var isBin = false;
    try {
      isBin = typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
    } catch (e) {
      isBin = false;
    }
    var nodeId = null;
    try { nodeId = item.nodeId; } catch (e) { nodeId = null; }
    var name = null;
    try { name = item.name; } catch (e) { name = null; }
    if (nodeId && !before[nodeId] && name === requestedName) {
      found = item;
      return;
    }
    if (isBin && item.children) {
      for (var i = 0; i < item.children.numItems; i++) {
        walk(item.children[i], depth + 1);
        if (found) {
          return;
        }
      }
    }
  }
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    walk(root.children[i], 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_createSubclip(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    // args.itemName addresses the SOURCE project item (never args.name) so
    // it never collides with the subclip's own new name, args.subclipName —
    // same split as add-marker-to-project-item's markerName-vs-name.
    var hasSourceNodeId = typeof args.nodeId === "string" && args.nodeId.length > 0;
    var hasSourceName = typeof args.itemName === "string" && args.itemName.length > 0;
    if (!hasSourceNodeId && !hasSourceName) {
      return JSON.stringify({ ok: false, error: "either nodeId or itemName is required to address the source project item" });
    }
    if (!args.subclipName || typeof args.subclipName !== "string") {
      return JSON.stringify({ ok: false, error: "subclipName is required (name for the new subclip)" });
    }
    if (typeof args.inSeconds !== "number" || typeof args.outSeconds !== "number") {
      return JSON.stringify({ ok: false, error: "inSeconds and outSeconds (numbers) are required" });
    }
    if (args.outSeconds <= args.inSeconds) {
      return JSON.stringify({ ok: false, error: "outSeconds must be greater than inSeconds" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemCreateSubclip_resolve({
      nodeId: hasSourceNodeId ? args.nodeId : null,
      name: hasSourceNodeId ? null : args.itemName
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no source project item found matching the given nodeId/itemName" });
    }

    var takeVideo = args.takeVideo !== false; // default true
    var takeAudio = args.takeAudio !== false; // default true

    var inTicks = String(Math.round(args.inSeconds * TICKS_PER_SECOND));
    var outTicks = String(Math.round(args.outSeconds * TICKS_PER_SECOND));

    var before = ppbCreateSubclip_snapshotNodeIds();

    // Trailing-arg order is disputed (PREMIERE_API_NOTES.md line 280 —
    // (name, inTicks, outTicks, hardBounds01, takeVideo01, takeAudio01) —
    // vs. the reference tool's own call, which passes hardBounds=0 then
    // takeVideo/takeAudio in that same order). Try the documented order
    // first, then a couple of plausible variants.
    var attempts = [];
    var attemptForms = [
      { label: "name,inTicks,outTicks,hardBounds,takeVideo,takeAudio", call: [args.subclipName, inTicks, outTicks, 0, takeVideo ? 1 : 0, takeAudio ? 1 : 0] },
      { label: "name,inTicks,outTicks,takeVideo,takeAudio,hardBounds", call: [args.subclipName, inTicks, outTicks, takeVideo ? 1 : 0, takeAudio ? 1 : 0, 0] },
      { label: "name,inTicks,outTicks,hardBounds", call: [args.subclipName, inTicks, outTicks, 0] }
    ];

    var newItem = null;
    var succeededWithArgs = null;

    for (var a = 0; a < attemptForms.length && newItem === null; a++) {
      var form = attemptForms[a];
      try {
        item.createSubClip.apply(item, form.call);
      } catch (e) {
        attempts.push({ form: form.label, success: false, error: e.toString() });
        continue;
      }

      var candidate = ppbCreateSubclip_findNewItem(before, args.subclipName);
      if (candidate !== null) {
        attempts.push({ form: form.label, success: true });
        succeededWithArgs = form.label;
        newItem = candidate;
      } else {
        attempts.push({ form: form.label, success: false, error: "call did not throw, but no new project item named \"" + args.subclipName + "\" was found afterward" });
      }
    }

    if (newItem === null) {
      return JSON.stringify({
        ok: false,
        error: "createSubClip() failed to produce a new project item with any known argument order — see attempts",
        attempts: attempts
      });
    }

    var newNodeId = null;
    try { newNodeId = newItem.nodeId; } catch (e) { newNodeId = null; }

    return JSON.stringify({
      ok: true,
      result: {
        sourceName: item.name,
        sourceNodeId: item.nodeId || null,
        subclipName: args.subclipName,
        nodeId: newNodeId,
        inSeconds: args.inSeconds,
        outSeconds: args.outSeconds,
        takeVideo: takeVideo,
        takeAudio: takeAudio,
        attempts: attempts,
        succeededWithArgs: succeededWithArgs
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
