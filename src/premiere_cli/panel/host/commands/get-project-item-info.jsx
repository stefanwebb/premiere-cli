// Command: get-project-item-info → ppb_getProjectItemInfo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Full detail on a single project item, identified by nodeId or treePath
// (at least one required). Merges the reference project's two near-
// duplicate tools (get_project_item_info in inspection.ts, get_item_info in
// media.ts) into one command — see the "Additional commands" doc note for
// why get-media-item-info was skipped. Helper names are prefixed
// ppbProjectItemInfo_ to avoid colliding with same-purpose helpers in other
// lazily-loaded command files evaluated into this same global context.

var PPB_PROJECT_ITEM_INFO_METADATA_MAX_CHARS = 10000;

function ppbProjectItemInfo_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

function ppbProjectItemInfo_typeToString(item) {
  try {
    if (typeof ProjectItemType !== "undefined") {
      if (item.type === ProjectItemType.BIN) {
        return "BIN";
      }
      if (item.type === ProjectItemType.CLIP) {
        return "CLIP";
      }
      if (item.type === ProjectItemType.FILE) {
        return "FILE";
      }
      if (item.type === ProjectItemType.ROOT) {
        return "ROOT";
      }
    }
  } catch (e) {
    // fall through to raw number below
  }
  return String(item.type);
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever.
function ppbProjectItemInfo_findByNodeId(item, nodeId, depth) {
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
  // Recurse into anything with children — the ROOT item's type is ROOT,
  // not BIN, so an isBin() gate here would never descend past the root
  // (live-debugged 2026-07-17: every lookup returned not-found).
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbProjectItemInfo_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// Capped at depth 32, same reasoning as ppbProjectItemInfo_findByNodeId.
function ppbProjectItemInfo_findByTreePath(item, treePath, depth) {
  if (depth > 32) {
    return null;
  }
  try {
    if (item.treePath === treePath) {
      return item;
    }
  } catch (e) {
    // fall through
  }
  // Recurse into anything with children — the ROOT item's type is ROOT,
  // not BIN, so an isBin() gate here would never descend past the root
  // (live-debugged 2026-07-17: every lookup returned not-found).
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbProjectItemInfo_findByTreePath(item.children[i], treePath, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppb_getProjectItemInfo(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasNodeId = typeof args.nodeId === "string" && args.nodeId.length > 0;
    var hasTreePath = typeof args.treePath === "string" && args.treePath.length > 0;

    if (!hasNodeId && !hasTreePath) {
      return JSON.stringify({ ok: false, error: "one of nodeId or treePath is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = null;
    var root = app.project.rootItem;
    if (hasNodeId) {
      item = ppbProjectItemInfo_findByNodeId(root, args.nodeId, 0);
      if (!item) {
        return JSON.stringify({ ok: false, error: "no project item found with nodeId \"" + args.nodeId + "\"" });
      }
    } else {
      item = ppbProjectItemInfo_findByTreePath(root, args.treePath, 0);
      if (!item) {
        return JSON.stringify({ ok: false, error: "no project item found with treePath \"" + args.treePath + "\"" });
      }
    }

    var info = {
      nodeId: null,
      name: null,
      type: null,
      treePath: null,
      mediaPath: null,
      isOffline: null,
      colorLabel: null,
      canChangeMediaPath: null,
      isSequence: null,
      isMulticamClip: null,
      isMergedClip: null,
      frameRate: null,
      pixelAspectRatio: null,
      fieldType: null,
      alphaUsage: null,
      ignoreAlpha: null,
      invertAlpha: null,
      inPointSeconds: null,
      outPointSeconds: null,
      hasProxy: null,
      canProxy: null,
      projectMetadata: null,
      projectMetadataLength: null,
      xmpMetadata: null,
      xmpMetadataLength: null,
      markers: [],
      childCount: null
    };

    try { info.nodeId = item.nodeId; } catch (e) { info.nodeId = null; }
    try { info.name = item.name; } catch (e) { info.name = null; }
    try { info.type = ppbProjectItemInfo_typeToString(item); } catch (e) { info.type = null; }
    try { info.treePath = item.treePath; } catch (e) { info.treePath = null; }
    try { info.mediaPath = item.getMediaPath(); } catch (e) { info.mediaPath = null; }
    try { info.isOffline = item.isOffline(); } catch (e) { info.isOffline = null; }
    try { info.colorLabel = item.getColorLabel(); } catch (e) { info.colorLabel = null; }
    try { info.canChangeMediaPath = item.canChangeMediaPath(); } catch (e) { info.canChangeMediaPath = null; }
    try { info.isSequence = item.isSequence(); } catch (e) { info.isSequence = null; }
    try { info.isMulticamClip = item.isMulticamClip(); } catch (e) { info.isMulticamClip = null; }
    try { info.isMergedClip = item.isMergedClip(); } catch (e) { info.isMergedClip = null; }

    try {
      var interp = item.getFootageInterpretation();
      if (interp) {
        try { info.frameRate = interp.frameRate; } catch (e) { info.frameRate = null; }
        try { info.pixelAspectRatio = interp.pixelAspectRatio; } catch (e) { info.pixelAspectRatio = null; }
        try { info.fieldType = interp.fieldType; } catch (e) { info.fieldType = null; }
        try { info.alphaUsage = interp.alphaUsage; } catch (e) { info.alphaUsage = null; }
        try { info.ignoreAlpha = interp.ignoreAlpha; } catch (e) { info.ignoreAlpha = null; }
        try { info.invertAlpha = interp.invertAlpha; } catch (e) { info.invertAlpha = null; }
      }
    } catch (e) {
      // leave footage-interpretation fields null
    }

    try { info.inPointSeconds = timeValueToSeconds(item.getInPoint()); } catch (e) { info.inPointSeconds = null; }
    try { info.outPointSeconds = timeValueToSeconds(item.getOutPoint()); } catch (e) { info.outPointSeconds = null; }

    try { info.hasProxy = item.hasProxy(); } catch (e) { info.hasProxy = null; }
    try { info.canProxy = item.canProxy(); } catch (e) { info.canProxy = null; }

    try {
      var xmp = item.getProjectMetadata();
      if (xmp && xmp.length > PPB_PROJECT_ITEM_INFO_METADATA_MAX_CHARS) {
        info.projectMetadataLength = xmp.length;
      } else if (xmp) {
        info.projectMetadata = xmp;
      }
    } catch (e) {
      // leave projectMetadata fields null
    }

    try {
      var xmp2 = item.getXMPMetadata();
      if (xmp2 && xmp2.length > PPB_PROJECT_ITEM_INFO_METADATA_MAX_CHARS) {
        info.xmpMetadataLength = xmp2.length;
      } else if (xmp2) {
        info.xmpMetadata = xmp2;
      }
    } catch (e) {
      // leave xmpMetadata fields null
    }

    try {
      var markerCollection = item.getMarkers();
      if (markerCollection) {
        var m = markerCollection.getFirstMarker();
        while (m) {
          var markerEntry = { name: null, comments: null, startSeconds: null, guid: null };
          try { markerEntry.name = m.name; } catch (e) { markerEntry.name = null; }
          try { markerEntry.guid = m.guid; } catch (e) { markerEntry.guid = null; }
          try { markerEntry.comments = m.comments; } catch (e) { markerEntry.comments = null; }
          try { markerEntry.startSeconds = timeValueToSeconds(m.start); } catch (e) { markerEntry.startSeconds = null; }
          info.markers.push(markerEntry);
          m = markerCollection.getNextMarker(m);
        }
      }
    } catch (e) {
      // leave markers as whatever was collected so far
    }

    if (ppbProjectItemInfo_isBin(item)) {
      try {
        info.childCount = item.children.numItems;
      } catch (e) {
        info.childCount = null;
      }
    }

    return JSON.stringify({ ok: true, result: info });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
