// Command: export-sequence → ppb_exportSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Exports the given (or active) sequence to a local file via the standard
// DOM's blocking seq.exportAsMediaDirect() — same synchronous, no-AME-
// dependency mechanism ppb_extractAudioTrack/ppb_exportFrame already use
// successfully (PREMIERE_API_NOTES.md: "Export direct (blocking)").
// Requires an explicit .epr presetPath — no default/auto-discovered preset
// (unlike extract-audio-track's bundled-audio-preset convenience), since
// video export presets vary too widely to guess a sane default.

// range → workAreaType per PREMIERE_API_NOTES.md's exportAsMediaDirect line:
// 0 = ENCODE_ENTIRE, 1 = ENCODE_IN_TO_OUT, 2 = ENCODE_WORKAREA.
function ppbExportSequenceRangeToWorkAreaType(range) {
  if (range === "entire" || range === undefined || range === null) {
    return { value: 0, label: "entire" };
  }
  if (range === "in-to-out") {
    return { value: 1, label: "in-to-out" };
  }
  if (range === "work-area") {
    return { value: 2, label: "work-area" };
  }
  return null;
}

function ppb_exportSequence(argsJson) {
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
    if (!args.presetPath || typeof args.presetPath !== "string") {
      return JSON.stringify({ ok: false, error: "presetPath is required (an absolute .epr file path)" });
    }

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

    var rangeInfo = ppbExportSequenceRangeToWorkAreaType(args.range);
    if (!rangeInfo) {
      return JSON.stringify({ ok: false, error: "range must be one of \"entire\", \"in-to-out\", \"work-area\"" });
    }

    var presetFile = new File(args.presetPath);
    if (!presetFile.exists) {
      return JSON.stringify({ ok: false, error: "preset file not found: " + args.presetPath });
    }

    var result = {
      sequenceName: seq.name,
      outputPath: args.outputPath,
      presetPath: args.presetPath,
      range: rangeInfo.label
    };

    try {
      seq.exportAsMediaDirect(args.outputPath, args.presetPath, rangeInfo.value);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "exportAsMediaDirect failed: " + e.toString() });
    }

    var outFile = new File(args.outputPath);
    if (!outFile.exists) {
      return JSON.stringify({
        ok: false,
        error: "exportAsMediaDirect ran but no file was written to " + args.outputPath +
          " (workAreaType=" + rangeInfo.value + ", preset=" + args.presetPath + ")"
      });
    }

    result.fileSizeBytes = outFile.length;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
