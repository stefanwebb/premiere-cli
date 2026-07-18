// Command: import-image-sequence → ppb_importImageSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's track-targeting.ts import_image_sequence
// tool. Imports a numbered image sequence as ONE clip via importFiles'
// 4th argument (asNumberedStills=true) per PREMIERE_API_NOTES.md. Same
// extension-allowlist/nodeId-diff verification approach as import-media.jsx
// (see that file's header) — duplicated under its own prefix since each
// lazily-loaded command file cannot rely on helpers defined only in
// another command file. Only the first frame's path is passed to
// importFiles(); Premiere itself detects the numbered sibling frames.

var PPB_IMPORT_IMAGE_SEQUENCE_ALLOWED_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "tiff", "tif", "bmp", "psd", "tga", "exr", "dpx", "webp"
];

function ppbImportImageSequence_extensionOf(path) {
  var lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) {
    return "";
  }
  return path.substring(lastDot + 1).toLowerCase();
}

function ppbImportImageSequence_isAllowedExtension(path) {
  var ext = ppbImportImageSequence_extensionOf(path);
  for (var i = 0; i < PPB_IMPORT_IMAGE_SEQUENCE_ALLOWED_EXTENSIONS.length; i++) {
    if (ext === PPB_IMPORT_IMAGE_SEQUENCE_ALLOWED_EXTENSIONS[i]) {
      return true;
    }
  }
  return false;
}

function ppbImportImageSequence_snapshotNodeIds(item, depth, seen) {
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
      ppbImportImageSequence_snapshotNodeIds(item.children[i], depth + 1, seen);
    }
  }
}

function ppbImportImageSequence_takeSnapshot() {
  var seen = {};
  ppbImportImageSequence_snapshotNodeIds(app.project.rootItem, 0, seen);
  return seen;
}

function ppbImportImageSequence_collectNew(item, depth, beforeSnapshot, out) {
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
      ppbImportImageSequence_collectNew(item.children[i], depth + 1, beforeSnapshot, out);
    }
  }
}

function ppbImportImageSequence_resolveBinPath(binPath) {
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

function ppb_importImageSequence(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.firstFramePath || typeof args.firstFramePath !== "string") {
      return JSON.stringify({ ok: false, error: "firstFramePath is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    if (!ppbImportImageSequence_isAllowedExtension(args.firstFramePath)) {
      return JSON.stringify({
        ok: false,
        error: "refusing to import — firstFramePath does not have a recognized image extension (an unsupported " +
          "format can pop a BLOCKING dialog that freezes the Premiere Bridge panel): " + args.firstFramePath,
        allowedExtensions: PPB_IMPORT_IMAGE_SEQUENCE_ALLOWED_EXTENSIONS
      });
    }

    var targetBin = app.project.rootItem;
    if (typeof args.targetBinPath === "string" && args.targetBinPath.length > 0) {
      var resolved = ppbImportImageSequence_resolveBinPath(args.targetBinPath);
      if (resolved.error) {
        return JSON.stringify({ ok: false, error: resolved.error });
      }
      targetBin = resolved.bin;
    }

    var before = ppbImportImageSequence_takeSnapshot();

    try {
      app.project.importFiles([args.firstFramePath], true, targetBin, true);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.project.importFiles() threw: " + e.toString() });
    }

    var imported = [];
    ppbImportImageSequence_collectNew(app.project.rootItem, 0, before, imported);

    if (imported.length === 0) {
      return JSON.stringify({
        ok: false,
        error: "importFiles() did not throw, but no new project item appeared (nodeId-diff found nothing)",
        firstFramePath: args.firstFramePath
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        firstFramePath: args.firstFramePath,
        targetBinPath: args.targetBinPath || null,
        asNumberedStills: true,
        importedCount: imported.length,
        imported: imported
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
