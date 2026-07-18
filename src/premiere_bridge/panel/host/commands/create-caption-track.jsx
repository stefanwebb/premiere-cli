// Command: create-caption-track → ppb_createCaptionTrack
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy's premiere-pro-mcp captions.ts
// create_caption_track. Creates a caption/subtitle track from an already-
// imported caption project item (e.g. an .srt file) via
// seq.createCaptionTrack(item, startSeconds, formatConstant) — the 3-arg
// signature PREMIERE_API_NOTES.md documents ("3rd arg is an INTEGER
// CONSTANT, NOT a string — 'Illegal Parameter type' otherwise"). Note
// this deliberately does NOT resolve to the same call add-text-overlay
// makes (that file's 1-arg createCaptionTrack(formatNum) — see its header
// comment for the arity conflict this reveals between reference repos).
//
// format is resolved via Sequence.CAPTION_FORMAT_* named constants with a
// typeof guard first (per PREMIERE_API_NOTES.md's constant list:
// SUBTITLE/608/708/TELETEXT/OPEN_EBU/OP42/OP47); if the named constant
// isn't present on this build, a known integer fallback (text.ts's own
// numeric map) is used ONLY for subtitle/608/708/teletext — ebu/op42/op47
// have no confirmed integer fallback anywhere in the reference repos, so
// those fail honestly if the named constant is unavailable.
//
// No caption READ API exists (PREMIERE_API_NOTES.md) — this command
// cannot verify the caption track's actual contents afterward, only that
// the call itself returned truthy.
function ppbFindItemCreateCaptionTrack_walk(item, args, depth) {
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
      var found = ppbFindItemCreateCaptionTrack_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemCreateCaptionTrack_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemCreateCaptionTrack_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

var PPB_CAPTION_FORMAT_CONSTANT_NAMES = {
  "subtitle": "CAPTION_FORMAT_SUBTITLE",
  "608": "CAPTION_FORMAT_608",
  "708": "CAPTION_FORMAT_708",
  "teletext": "CAPTION_FORMAT_TELETEXT",
  "ebu": "CAPTION_FORMAT_OPEN_EBU",
  "op42": "CAPTION_FORMAT_OP42",
  "op47": "CAPTION_FORMAT_OP47"
};

var PPB_CAPTION_FORMAT_INT_FALLBACKS = { "subtitle": 3, "608": 1, "708": 2, "teletext": 4 };

function ppb_createCaptionTrack(argsJson) {
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
      return JSON.stringify({ ok: false, error: "either nodeId or name is required to identify the caption project item (e.g. an imported .srt)" });
    }
    if (typeof args.startSeconds !== "number") {
      return JSON.stringify({ ok: false, error: "startSeconds is required" });
    }

    var format = (typeof args.format === "string" && PPB_CAPTION_FORMAT_CONSTANT_NAMES.hasOwnProperty(args.format)) ? args.format : "subtitle";

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ ok: false, error: "no active sequence" });
    }

    var item = ppbFindItemCreateCaptionTrack_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var constantName = PPB_CAPTION_FORMAT_CONSTANT_NAMES[format];
    var formatValue = null;
    var usedFallbackInt = false;
    try {
      if (typeof Sequence !== "undefined" && typeof Sequence[constantName] !== "undefined") {
        formatValue = Sequence[constantName];
      }
    } catch (e2) {
      formatValue = null;
    }
    if (formatValue === null) {
      if (PPB_CAPTION_FORMAT_INT_FALLBACKS.hasOwnProperty(format)) {
        formatValue = PPB_CAPTION_FORMAT_INT_FALLBACKS[format];
        usedFallbackInt = true;
      } else {
        return JSON.stringify({ ok: false, error: "Sequence." + constantName + " is not available on this build, and format \"" + format + "\" has no known integer fallback" });
      }
    }

    var createResult = null;
    try {
      createResult = seq.createCaptionTrack(item, args.startSeconds, formatValue);
    } catch (e3) {
      return JSON.stringify({ ok: false, error: "seq.createCaptionTrack() failed: " + e3.toString() });
    }
    if (!createResult) {
      return JSON.stringify({ ok: false, error: "seq.createCaptionTrack() returned a falsy result" });
    }

    return JSON.stringify({
      ok: true,
      result: {
        created: true,
        item: { name: (function () { try { return item.name; } catch (e) { return null; } })(), nodeId: (function () { try { return item.nodeId; } catch (e) { return null; } })() },
        startSeconds: args.startSeconds,
        format: format,
        formatValue: formatValue,
        usedFallbackInt: usedFallbackInt,
        note: "no caption READ API exists on this build — this only confirms the create call returned truthy, not the track's actual rendered contents."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
