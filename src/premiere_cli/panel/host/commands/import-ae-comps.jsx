// Command: import-ae-comps → ppb_importAeComps
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts import_ae_comps.
// Calls app.project.importAEComps(aep, [names], bin) if compNames is
// given, else app.project.importAllAEComps(aep, bin) — both per
// PREMIERE_API_NOTES.md's Project/bins/import section. targetBinPath
// resolves via the same '/'-separated-path bin walk as get-bin-contents.
// jsx (never auto-created — must already exist); omitted defaults to
// app.project.rootItem. Verified by a target-bin children-count increase
// (never trusting the call's own return value).
//
// Helper names prefixed ppbImportAeComps_ to avoid colliding with
// same-purpose helpers in other lazily-loaded command files evaluated
// into this same global context.

function ppbImportAeComps_isBin(item) {
  try {
    return typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    return false;
  }
}

function ppbImportAeComps_findBin(binPath) {
  var segments = binPath.split("/").filter(function (s) { return s.length > 0; });
  var current = app.project.rootItem;

  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    var found = null;

    for (var j = 0; j < current.children.numItems; j++) {
      var child = current.children[j];
      if (child.name === segment && ppbImportAeComps_isBin(child)) {
        found = child;
        break;
      }
    }

    if (!found) {
      return null;
    }
    current = found;
  }

  return current;
}

function ppb_importAeComps(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.aepPath || typeof args.aepPath !== "string") {
      return JSON.stringify({ ok: false, error: "aepPath is required" });
    }

    var file = new File(args.aepPath);
    if (!file.exists) {
      return JSON.stringify({ ok: false, error: "no file exists at aepPath: " + args.aepPath });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var targetBin = app.project.rootItem;
    if (args.targetBinPath && typeof args.targetBinPath === "string") {
      var found = ppbImportAeComps_findBin(args.targetBinPath);
      if (!found) {
        return JSON.stringify({ ok: false, error: "no bin found at targetBinPath \"" + args.targetBinPath + "\"" });
      }
      targetBin = found;
    }

    var hasNames = Object.prototype.toString.call(args.compNames) === "[object Array]" && args.compNames.length > 0;

    var countBefore = targetBin.children.numItems;

    try {
      if (hasNames) {
        if (typeof app.project.importAEComps !== "function") {
          return JSON.stringify({ ok: false, error: "importAEComps is not available on this Premiere build" });
        }
        app.project.importAEComps(args.aepPath, args.compNames, targetBin);
      } else {
        if (typeof app.project.importAllAEComps !== "function") {
          return JSON.stringify({ ok: false, error: "importAllAEComps is not available on this Premiere build" });
        }
        app.project.importAllAEComps(args.aepPath, targetBin);
      }
    } catch (e) {
      return JSON.stringify({ ok: false, error: "AE comp import failed: " + e.toString() });
    }

    var countAfter = targetBin.children.numItems;
    var imported = countAfter > countBefore;

    if (!imported) {
      return JSON.stringify({
        ok: false,
        error: "the import call did not throw, but the target bin's item count did not increase",
        countBefore: countBefore,
        countAfter: countAfter
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        imported: true,
        aepPath: args.aepPath,
        compNames: hasNames ? args.compNames : null,
        allComps: !hasNames,
        targetBinPath: args.targetBinPath || null,
        countBefore: countBefore,
        countAfter: countAfter
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
