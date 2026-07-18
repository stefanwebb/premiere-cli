// Command: freeze-frame → ppb_freezeFrame
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, TICKS_PER_SECOND, resolveTimelineClip,
// activateSequenceForQE, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's utility.ts freeze_frame —
// mirrored FAITHFULLY, not "fixed up": the reference tool's own
// "freeze frame" is an export-a-still + re-import-as-a-project-item
// operation, explicitly telling its caller to add the resulting still to
// the timeline manually afterward. It does NOT create an actual frozen
// clip on the timeline via Time Remapping "Speed" keyframes at 0 (the
// mechanism PREMIERE_API_NOTES.md documents as the "real" way Premiere
// itself implements a freeze frame) — the reference tool never attempts
// that. This command reproduces the reference's actual behavior
// (export + reimport) rather than inventing a different, unverified
// Time-Remapping implementation the reference never demonstrated.
//
// Clip addressing (trackType/trackIndex/clipIndex, same as
// get-full-clip-info) replaces the reference's playhead-only addressing,
// so a specific clip can be targeted without first moving the playhead;
// atSeconds (clip-relative or omitted = the clip's own start) still
// selects WHICH frame within that clip is frozen. Reuses export-frame's
// confirmed-live QE quirk (exportFramePNG(path, path) — the same path
// passed twice) rather than re-probing every arg-order guess export-frame
// itself tries, since that exact form is the one already confirmed
// working on this build.
function ppb_freezeFrame(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.outputPath || typeof args.outputPath !== "string") {
      return JSON.stringify({ ok: false, error: "outputPath is required" });
    }
    if (typeof args.trackIndex !== "number" || typeof args.clipIndex !== "number") {
      return JSON.stringify({ ok: false, error: "trackIndex and clipIndex are both required" });
    }
    var trackType = args.trackType === "audio" ? "audio" : "video";

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var seq = null;
    if (args.sequenceName && typeof args.sequenceName === "string") {
      seq = findSequenceByName(args.sequenceName);
      if (!seq) {
        return JSON.stringify({ ok: false, error: "no sequence named \"" + args.sequenceName + "\" is open" });
      }
    } else {
      seq = app.project.activeSequence;
      if (!seq) {
        return JSON.stringify({ ok: false, error: "no active sequence, and no sequenceName given" });
      }
    }
    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
    }

    var clipResolved = resolveTimelineClip(seq, trackType, args.trackIndex, args.clipIndex);
    if (clipResolved.error) {
      return JSON.stringify({ ok: false, error: clipResolved.error });
    }
    var clip = clipResolved.clip;
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var atSeconds;
    if (typeof args.atSeconds === "number" && !isNaN(args.atSeconds)) {
      atSeconds = args.atSeconds;
    } else {
      try {
        atSeconds = clip.start.seconds;
      } catch (e) {
        return JSON.stringify({ ok: false, error: "atSeconds was omitted and the clip's own start time could not be read: " + e.toString() });
      }
    }

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() returned nothing after activating the sequence" });
    }

    var originalPosition = null;
    try { originalPosition = seq.getPlayerPosition(); } catch (e) { originalPosition = null; }

    var ticksString = String(Math.round(atSeconds * TICKS_PER_SECOND));
    var positionSet = false;
    var positionError = null;
    try {
      seq.setPlayerPosition(ticksString);
      positionSet = true;
    } catch (e) {
      positionError = e.toString();
    }

    try {
      if (!positionSet) {
        return JSON.stringify({
          ok: false,
          error: "could not move the playhead to atSeconds: " + positionError
        });
      }

      var exportFile = new File(args.outputPath);
      if (exportFile.exists) {
        try { exportFile.remove(); } catch (e) { /* best-effort */ }
      }

      var exportError = null;
      try {
        qeSeq.exportFramePNG(args.outputPath, args.outputPath);
      } catch (e) {
        exportError = e.toString();
      }

      var producedFile = new File(args.outputPath);
      var producedExists = producedFile.exists && producedFile.length > 0;
      if (!producedExists) {
        // export-frame.jsx documents Premiere sometimes writing under a
        // ".png.png" double-extension variant for this exact call form —
        // check for it before giving up.
        var doubleExt = new File(args.outputPath + ".png");
        if (doubleExt.exists && doubleExt.length > 0) {
          try {
            doubleExt.rename(decodeURI(new File(args.outputPath).name));
            producedFile = new File(args.outputPath);
            producedExists = producedFile.exists && producedFile.length > 0;
          } catch (e) {
            // fall through — reported as a failure below
          }
        }
      }

      if (!producedExists) {
        return JSON.stringify({
          ok: false,
          error: "exportFramePNG(outputPath, outputPath) did not produce a file" + (exportError ? (": " + exportError) : ""),
          clipName: clipName,
          atSeconds: atSeconds
        });
      }

      var numItemsBefore = app.project.rootItem.children.numItems;
      var importError = null;
      try {
        app.project.importFiles([args.outputPath], false, app.project.rootItem, false);
      } catch (e) {
        importError = e.toString();
      }
      var numItemsAfter = app.project.rootItem.children.numItems;
      var imported = numItemsAfter > numItemsBefore;

      var importedItem = null;
      if (imported) {
        try {
          var candidateName = decodeURI(producedFile.name);
          for (var i = app.project.rootItem.children.numItems - 1; i >= 0; i--) {
            var candidate = app.project.rootItem.children[i];
            var cName = null;
            try { cName = candidate.name; } catch (e) { cName = null; }
            if (cName === candidateName) {
              importedItem = candidate;
              break;
            }
          }
        } catch (e) {
          importedItem = null;
        }
      }

      return JSON.stringify({
        ok: imported,
        result: {
          sequenceName: seq.name,
          trackType: trackType,
          trackIndex: args.trackIndex,
          clipIndex: args.clipIndex,
          clipName: clipName,
          atSeconds: atSeconds,
          outputPath: args.outputPath,
          fileSizeBytes: producedFile.length,
          imported: imported,
          importedItem: importedItem ? { name: importedItem.name, nodeId: importedItem.nodeId } : null,
          importError: importError,
          note: "matches the reference tool's own freeze-frame behavior: exports a still and imports it as a project item — it does NOT place a frozen clip on the timeline via Time Remapping Speed keyframes (the mechanism Premiere itself uses internally per PREMIERE_API_NOTES.md); add the imported still to the timeline manually (e.g. via a future add-to-timeline command)."
        }
      });
    } finally {
      if (originalPosition !== null) {
        try {
          seq.setPlayerPosition(originalPosition.ticks);
        } catch (e) {
          // best-effort
        }
      }
    }
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
