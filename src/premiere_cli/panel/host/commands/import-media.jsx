// Command: import-media → ppb_importMedia
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts import_media tool. Per
// PREMIERE_API_NOTES.md's "Project / bins / import" section:
// app.project.importFiles()'s own return value is unreliable, and an
// unsupported/unrecognized file extension can pop a BLOCKING modal dialog
// that freezes the whole CEP bridge — so files are pre-filtered against a
// safe extension allowlist below, and success is verified by diffing
// nodeId snapshots of the whole project tree before/after the import call,
// never by trusting importFiles()'s return value. Helper names are
// prefixed ppbImportMedia_ to avoid colliding with same-purpose helpers in
// other lazily-loaded command files evaluated into this same global
// context (import-folder.jsx and import-image-sequence.jsx duplicate this
// allowlist/snapshot logic under their own prefixes for the same reason).

var PPB_IMPORT_MEDIA_ALLOWED_EXTENSIONS = [
  // video
  "mp4", "mov", "avi", "mkv", "webm", "mxf", "m4v", "wmv", "mpg", "mpeg",
  // audio
  "wav", "mp3", "aac", "m4a", "aif", "aiff", "flac", "ogg",
  // image
  "png", "jpg", "jpeg", "gif", "tiff", "tif", "bmp", "psd", "tga", "exr", "dpx", "webp",
  // project
  "prproj"
];

function ppbImportMedia_extensionOf(path) {
  var lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) {
    return "";
  }
  return path.substring(lastDot + 1).toLowerCase();
}

function ppbImportMedia_isAllowedExtension(path) {
  var ext = ppbImportMedia_extensionOf(path);
  for (var i = 0; i < PPB_IMPORT_MEDIA_ALLOWED_EXTENSIONS.length; i++) {
    if (ext === PPB_IMPORT_MEDIA_ALLOWED_EXTENSIONS[i]) {
      return true;
    }
  }
  return false;
}

// Depth-capped (32) recursive walk collecting every nodeId currently in the
// project, keyed in a plain object for O(1) diffing. Recurses on
// children-presence (item.children truthy), NOT an isBin() gate — the
// ROOT item's type is ROOT, not BIN, and per get-project-item-info.jsx's
// live-debugged finding, an isBin() gate here would silently stop any
// walk that starts at the root itself. Snapshot walks in this file always
// start at rootItem.children, but the same helper is reused by the
// resolveBinPath below which DOES start at rootItem, so the non-gated
// form is used uniformly.
function ppbImportMedia_snapshotNodeIds(item, depth, seen) {
  if (depth > 32) {
    return;
  }
  try {
    if (item.nodeId) {
      seen[item.nodeId] = true;
    }
  } catch (e) {
    // ignore
  }
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbImportMedia_snapshotNodeIds(item.children[i], depth + 1, seen);
    }
  }
}

function ppbImportMedia_takeSnapshot() {
  var seen = {};
  var root = app.project.rootItem;
  ppbImportMedia_snapshotNodeIds(root, 0, seen);
  return seen;
}

// Finds every item in the current project whose nodeId isn't in
// `beforeSnapshot` — the newly-imported items. Depth-capped the same way.
function ppbImportMedia_collectNew(item, depth, beforeSnapshot, out) {
  if (depth > 32) {
    return;
  }
  try {
    if (item.nodeId && !beforeSnapshot[item.nodeId]) {
      var entry = { name: null, nodeId: null, treePath: null, mediaPath: null };
      try { entry.name = item.name; } catch (e) { entry.name = null; }
      try { entry.nodeId = item.nodeId; } catch (e) { entry.nodeId = null; }
      try { entry.treePath = item.treePath; } catch (e) { entry.treePath = null; }
      try { entry.mediaPath = item.getMediaPath(); } catch (e) { entry.mediaPath = null; }
      out.push(entry);
    }
  } catch (e) {
    // ignore
  }
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      ppbImportMedia_collectNew(item.children[i], depth + 1, beforeSnapshot, out);
    }
  }
}

// Resolves (but does NOT create) a '/'-separated bin path against the
// project's root bin. Returns {bin} on success or {error} if any segment
// is missing.
function ppbImportMedia_resolveBinPath(binPath) {
  var segments = binPath.split("/").filter(function (s) { return s.length > 0; });
  var current = app.project.rootItem;
  for (var i = 0; i < segments.length; i++) {
    var found = null;
    for (var j = 0; j < current.children.numItems; j++) {
      var child = current.children[j];
      if (child.name === segments[i] && typeof ProjectItemType !== "undefined" && child.type === ProjectItemType.BIN) {
        found = child;
        break;
      }
    }
    if (!found) {
      return { error: "bin path segment \"" + segments[i] + "\" not found in \"" + binPath + "\" (target bin must already exist)" };
    }
    current = found;
  }
  return { bin: current };
}

function ppb_importMedia(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var filePaths = null;
    if (typeof args.filePaths === "string" && args.filePaths.length > 0) {
      try {
        filePaths = JSON.parse(args.filePaths);
      } catch (e) {
        return JSON.stringify({ ok: false, error: "filePaths must be a JSON array string: " + e.toString() });
      }
    } else if (args.filePaths instanceof Array) {
      filePaths = args.filePaths;
    } else if (typeof args.filePath === "string" && args.filePath.length > 0) {
      filePaths = [args.filePath];
    }

    if (!filePaths || !(filePaths instanceof Array) || filePaths.length === 0) {
      return JSON.stringify({ ok: false, error: "either filePath (string) or filePaths (JSON array) is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var refused = [];
    for (var i = 0; i < filePaths.length; i++) {
      if (!ppbImportMedia_isAllowedExtension(filePaths[i])) {
        refused.push(filePaths[i]);
      }
    }
    if (refused.length > 0) {
      return JSON.stringify({
        ok: false,
        error: "refusing to import file(s) with an unrecognized extension — an unsupported format can pop a " +
          "BLOCKING dialog that freezes the Premiere Bridge panel: " + refused.join(", "),
        refused: refused,
        allowedExtensions: PPB_IMPORT_MEDIA_ALLOWED_EXTENSIONS
      });
    }

    var targetBin = app.project.rootItem;
    if (typeof args.targetBinPath === "string" && args.targetBinPath.length > 0) {
      var resolved = ppbImportMedia_resolveBinPath(args.targetBinPath);
      if (resolved.error) {
        return JSON.stringify({ ok: false, error: resolved.error });
      }
      targetBin = resolved.bin;
    }

    var before = ppbImportMedia_takeSnapshot();

    try {
      app.project.importFiles(filePaths, true, targetBin, false);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.project.importFiles() threw: " + e.toString() });
    }

    var imported = [];
    ppbImportMedia_collectNew(app.project.rootItem, 0, before, imported);

    if (imported.length === 0) {
      return JSON.stringify({
        ok: false,
        error: "importFiles() did not throw, but no new project item appeared (nodeId-diff found nothing) — " +
          "the file(s) may already be in the project, or the import silently failed",
        requestedFiles: filePaths
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        requestedFiles: filePaths,
        targetBinPath: args.targetBinPath || null,
        importedCount: imported.length,
        imported: imported
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
