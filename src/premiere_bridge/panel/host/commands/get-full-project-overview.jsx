// Command: get-full-project-overview → ppb_getFullProjectOverview
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Builds a nested bin tree of the whole project plus a mediaTypeCounts
// classification of every non-bin item by its mediaPath extension. Helper
// names are prefixed ppbFullOverview_ to avoid colliding with same-purpose
// helpers in other lazily-loaded command files evaluated into this same
// global context.

var PPB_FULL_OVERVIEW_VIDEO_EXTENSIONS = ["mp4", "mov", "mxf", "avi", "m4v", "mts"];
var PPB_FULL_OVERVIEW_AUDIO_EXTENSIONS = ["wav", "mp3", "aac", "m4a", "aiff"];
var PPB_FULL_OVERVIEW_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "tif", "tiff", "psd", "svg", "gif"];

function ppbFullOverview_extOf(mediaPath) {
  if (!mediaPath || typeof mediaPath !== "string") {
    return null;
  }
  var dot = mediaPath.lastIndexOf(".");
  if (dot === -1 || dot === mediaPath.length - 1) {
    return null;
  }
  return mediaPath.substring(dot + 1).toLowerCase();
}

function ppbFullOverview_inList(ext, list) {
  if (ext === null) {
    return false;
  }
  for (var i = 0; i < list.length; i++) {
    if (list[i] === ext) {
      return true;
    }
  }
  return false;
}

function ppbFullOverview_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

function ppbFullOverview_typeToString(item) {
  try {
    if (typeof ProjectItemType !== "undefined") {
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

// Classifies one non-bin item into counts. A sequence item always counts
// as "sequence" regardless of any extension on its mediaPath. An offline
// item ADDITIONALLY increments "offline", on top of its type bucket.
function ppbFullOverview_classify(item, counts) {
  var isSequence = false;
  try {
    isSequence = item.isSequence();
  } catch (e) {
    isSequence = false;
  }

  var isOffline = false;
  try {
    isOffline = item.isOffline();
  } catch (e) {
    isOffline = false;
  }

  var mediaPath = null;
  try {
    mediaPath = item.getMediaPath();
  } catch (e) {
    mediaPath = null;
  }

  if (isSequence) {
    counts.sequence++;
  } else {
    var ext = ppbFullOverview_extOf(mediaPath);
    if (ppbFullOverview_inList(ext, PPB_FULL_OVERVIEW_VIDEO_EXTENSIONS)) {
      counts.video++;
    } else if (ppbFullOverview_inList(ext, PPB_FULL_OVERVIEW_AUDIO_EXTENSIONS)) {
      counts.audio++;
    } else if (ppbFullOverview_inList(ext, PPB_FULL_OVERVIEW_IMAGE_EXTENSIONS)) {
      counts.image++;
    } else {
      counts.other++;
    }
  }

  if (isOffline) {
    counts.offline++;
  }
}

// Capped at depth 32 to defend against pathological/circular bin
// structures rather than looping forever.
function ppbFullOverview_buildBinTree(item, counts, depth) {
  var node = { name: item.name, bins: [], items: [] };

  if (depth > 32 || !item.children) {
    return node;
  }

  for (var i = 0; i < item.children.numItems; i++) {
    var child = item.children[i];

    if (ppbFullOverview_isBin(child)) {
      node.bins.push(ppbFullOverview_buildBinTree(child, counts, depth + 1));
    } else {
      var mediaPath = null;
      try {
        mediaPath = child.getMediaPath();
      } catch (e) {
        mediaPath = null;
      }

      node.items.push({
        name: child.name,
        type: ppbFullOverview_typeToString(child),
        mediaPath: mediaPath
      });
      ppbFullOverview_classify(child, counts);
    }
  }

  return node;
}

function ppb_getFullProjectOverview(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var proj = app.project;
    var sequences = [];

    for (var j = 0; j < proj.sequences.numSequences; j++) {
      var seq = proj.sequences[j];
      var frameRate = null;
      var durationSeconds = null;

      try {
        frameRate = TICKS_PER_SECOND / Number(seq.timebase);
      } catch (e) {
        frameRate = null;
      }

      try {
        durationSeconds = (Number(seq.end) - Number(seq.zeroPoint)) / TICKS_PER_SECOND;
      } catch (e) {
        durationSeconds = null;
      }

      sequences.push({
        name: seq.name,
        sequenceID: seq.sequenceID,
        frameRate: frameRate,
        durationSeconds: durationSeconds
      });
    }

    var counts = { video: 0, audio: 0, image: 0, sequence: 0, other: 0, offline: 0 };
    var binTree = ppbFullOverview_buildBinTree(proj.rootItem, counts, 1);

    var result = {
      project: { name: proj.name, path: proj.path },
      binTree: binTree,
      sequences: sequences,
      mediaTypeCounts: counts
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
