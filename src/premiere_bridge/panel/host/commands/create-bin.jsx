// Command: create-bin → ppb_createBin
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Creates every missing segment of a '/'-separated bin path via
// parentBin.createBin(name), same bin-path-walking approach as
// create-sequence.jsx's own bin argument. Reports which segments already
// existed vs. were newly created, rather than silently no-oping on an
// existing path.

function ppb_createBin(argsJson) {
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

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var segments = args.binPath.split("/").filter(function (s) { return s.length > 0; });
    if (segments.length === 0) {
      return JSON.stringify({ ok: false, error: "binPath must contain at least one non-empty segment" });
    }

    var current = app.project.rootItem;
    var createdSegments = [];
    var existedSegments = [];

    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      var found = null;
      for (var j = 0; j < current.children.numItems; j++) {
        var child = current.children[j];
        if (child.name === segment && typeof ProjectItemType !== "undefined" && child.type === ProjectItemType.BIN) {
          found = child;
          break;
        }
      }
      if (found) {
        existedSegments.push(segment);
        current = found;
      } else {
        var created;
        try {
          created = current.createBin(segment);
        } catch (e) {
          return JSON.stringify({ ok: false, error: "createBin(\"" + segment + "\") failed: " + e.toString() });
        }
        createdSegments.push(segment);
        current = created;
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        binPath: args.binPath,
        nodeId: current.nodeId,
        createdSegments: createdSegments,
        existedSegments: existedSegments,
        alreadyExisted: createdSegments.length === 0
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
