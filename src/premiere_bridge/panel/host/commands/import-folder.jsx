// Command: import-folder → ppb_importFolder
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts import_folder tool. Same
// extension-allowlist/nodeId-diff verification approach as import-media.jsx
// (see that file's header for the dialog-freeze rationale) — duplicated
// here under its own prefix since each lazily-loaded command file cannot
// rely on helpers defined only in another command file.

var PPB_IMPORT_FOLDER_ALLOWED_EXTENSIONS = [
  "mp4", "mov", "avi", "mkv", "webm", "mxf", "m4v", "wmv", "mpg", "mpeg",
  "wav", "mp3", "aac", "m4a", "aif", "aiff", "flac", "ogg",
  "png", "jpg", "jpeg", "gif", "tiff", "tif", "bmp", "psd", "tga", "exr", "dpx", "webp",
  "prproj"
];

function ppbImportFolder_extensionOf(path) {
  var lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) {
    return "";
  }
  return path.substring(lastDot + 1).toLowerCase();
}

function ppbImportFolder_isAllowedExtension(path) {
  var ext = ppbImportFolder_extensionOf(path);
  for (var i = 0; i < PPB_IMPORT_FOLDER_ALLOWED_EXTENSIONS.length; i++) {
    if (ext === PPB_IMPORT_FOLDER_ALLOWED_EXTENSIONS[i]) {
      return true;
    }
  }
  return false;
}

function ppbImportFolder_snapshotNodeIds(item, depth, seen) {
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
      ppbImportFolder_snapshotNodeIds(item.children[i], depth + 1, seen);
    }
  }
}

function ppbImportFolder_takeSnapshot() {
  var seen = {};
  ppbImportFolder_snapshotNodeIds(app.project.rootItem, 0, seen);
  return seen;
}

function ppbImportFolder_collectNew(item, depth, beforeSnapshot, out) {
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
      ppbImportFolder_collectNew(item.children[i], depth + 1, beforeSnapshot, out);
    }
  }
}

function ppbImportFolder_resolveBinPath(binPath) {
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

function ppb_importFolder(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.folderPath || typeof args.folderPath !== "string") {
      return JSON.stringify({ ok: false, error: "folderPath is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var folder = new Folder(args.folderPath);
    if (!folder.exists) {
      return JSON.stringify({ ok: false, error: "folder not found: " + args.folderPath });
    }

    var files = folder.getFiles();
    var candidatePaths = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i] instanceof File) {
        candidatePaths.push(files[i].fsName);
      }
    }

    if (candidatePaths.length === 0) {
      return JSON.stringify({ ok: false, error: "no files found in folder: " + args.folderPath });
    }

    var allowed = [];
    var refused = [];
    for (var p = 0; p < candidatePaths.length; p++) {
      if (ppbImportFolder_isAllowedExtension(candidatePaths[p])) {
        allowed.push(candidatePaths[p]);
      } else {
        refused.push(candidatePaths[p]);
      }
    }

    if (allowed.length === 0) {
      return JSON.stringify({
        ok: false,
        error: "refusing to import — none of the folder's files have a recognized extension (an unsupported " +
          "format can pop a BLOCKING dialog that freezes the Premiere Bridge panel)",
        refused: refused,
        allowedExtensions: PPB_IMPORT_FOLDER_ALLOWED_EXTENSIONS
      });
    }

    var targetBin = app.project.rootItem;
    if (typeof args.targetBinPath === "string" && args.targetBinPath.length > 0) {
      var resolved = ppbImportFolder_resolveBinPath(args.targetBinPath);
      if (resolved.error) {
        return JSON.stringify({ ok: false, error: resolved.error });
      }
      targetBin = resolved.bin;
    }

    var before = ppbImportFolder_takeSnapshot();

    try {
      app.project.importFiles(allowed, true, targetBin, false);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.project.importFiles() threw: " + e.toString() });
    }

    var imported = [];
    ppbImportFolder_collectNew(app.project.rootItem, 0, before, imported);

    return JSON.stringify({
      ok: true,
      result: {
        folderPath: args.folderPath,
        targetBinPath: args.targetBinPath || null,
        candidateCount: candidatePaths.length,
        refusedCount: refused.length,
        refused: refused,
        importedCount: imported.length,
        imported: imported
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
