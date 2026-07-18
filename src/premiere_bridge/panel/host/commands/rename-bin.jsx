// Command: rename-bin → ppb_renameBin
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's project.ts rename_bin tool. Resolves a
// '/'-separated bin path (same convention as create-sequence's bin arg and
// get-bin-contents' binPath — never auto-created here) and renames it via
// bin.renameBin(newName). Verified via a name read-back. Undo is
// non-functional on this build — there is no previousValue restoration
// beyond renaming back manually (oldName is reported).

function ppbRenameBin_resolveBinPath(binPath) {
  var segments = binPath.split("/").filter(function (s) { return s.length > 0; });
  if (segments.length === 0) {
    return { error: "binPath must contain at least one non-empty segment" };
  }
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
      return { error: "bin path segment \"" + segments[i] + "\" not found in \"" + binPath + "\"" };
    }
    current = found;
  }
  return { bin: current };
}

function ppb_renameBin(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.binPath || typeof args.binPath !== "string") {
      return JSON.stringify({ ok: false, error: "binPath is required" });
    }
    if (!args.newName || typeof args.newName !== "string") {
      return JSON.stringify({ ok: false, error: "newName is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var resolved = ppbRenameBin_resolveBinPath(args.binPath);
    if (resolved.error) {
      return JSON.stringify({ ok: false, error: resolved.error });
    }
    var bin = resolved.bin;

    var oldName = null;
    try { oldName = bin.name; } catch (e) { oldName = null; }

    try {
      bin.renameBin(args.newName);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "renameBin() failed: " + e.toString() });
    }

    var newName = null;
    try { newName = bin.name; } catch (e) { newName = null; }

    return JSON.stringify({
      ok: true,
      result: {
        binPath: args.binPath,
        nodeId: bin.nodeId,
        oldName: oldName,
        requestedName: args.newName,
        newName: newName,
        verified: newName === args.newName
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
