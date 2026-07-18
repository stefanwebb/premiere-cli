// Command: get-unused-media → ppb_getUnusedMedia
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Two-pass: first collects every project-item nodeId referenced by any
// clip in any sequence, then walks the whole bin tree (same shape as
// list-project-items.jsx) reporting non-bin items whose nodeId was never
// seen. Helper names are prefixed ppbUnusedMedia_ to avoid colliding with
// same-purpose helpers in other lazily-loaded command files evaluated into
// this same global context.

function ppbUnusedMedia_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

function ppbUnusedMedia_collectUsedIds(tracks, usedIds) {
  for (var t = 0; t < tracks.numTracks; t++) {
    var track = tracks[t];
    var numClips = 0;
    try {
      numClips = track.clips.numItems;
    } catch (e) {
      numClips = 0;
    }
    for (var c = 0; c < numClips; c++) {
      try {
        var src = track.clips[c].projectItem;
        if (src) {
          usedIds[src.nodeId] = true;
        }
      } catch (e) {
        // skip unreadable clip
      }
    }
  }
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever.
function ppbUnusedMedia_findUnused(item, depth, usedIds, results) {
  if (depth > 32) {
    return;
  }

  var isBin = ppbUnusedMedia_isBin(item);

  if (!isBin) {
    var nodeId = null;
    try {
      nodeId = item.nodeId;
    } catch (e) {
      nodeId = null;
    }

    if (nodeId && !usedIds[nodeId]) {
      var entry = { nodeId: nodeId, name: null, treePath: null, mediaPath: null };
      try { entry.name = item.name; } catch (e) { entry.name = null; }
      try { entry.treePath = item.treePath; } catch (e) { entry.treePath = null; }
      try { entry.mediaPath = item.getMediaPath(); } catch (e) { entry.mediaPath = null; }
      results.push(entry);
    }
  }

  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbUnusedMedia_findUnused(item.children[i], depth + 1, usedIds, results);
    }
  }
}

function ppb_getUnusedMedia(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var usedIds = {};
    for (var s = 0; s < app.project.sequences.numSequences; s++) {
      var seq = app.project.sequences[s];
      ppbUnusedMedia_collectUsedIds(seq.videoTracks, usedIds);
      ppbUnusedMedia_collectUsedIds(seq.audioTracks, usedIds);
    }

    var results = [];
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
      ppbUnusedMedia_findUnused(root.children[i], 1, usedIds, results);
    }

    return JSON.stringify({ ok: true, result: { unusedCount: results.length, items: results } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
