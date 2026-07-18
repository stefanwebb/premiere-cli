// Command: add-to-render-queue → ppb_addToRenderQueue
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Queues the given (or active) sequence for export in Adobe Media Encoder
// via app.encoder.launchEncoder() + encodeSequence() + startBatch()
// (PREMIERE_API_NOTES.md's "Export via AME" line). **Fire-and-forget**:
// there is no progress API — encodeSequence() returns as soon as the job
// is queued, long before AME finishes writing the file, so this command
// can NEVER verify the output file the way the exportAsMediaDirect-based
// commands (export-sequence, extract-audio-track) do. Callers must poll
// the output path themselves (or use get-render-queue-status, itself only
// an isRunning() probe) — presetPath MUST be an absolute .epr file path;
// a bare name like "H.264" silently fails with no jobID per
// PREMIERE_API_NOTES.md.

// range → workAreaType, same mapping as export-sequence's
// ppbExportSequenceRangeToWorkAreaType (duplicated here since each command
// file loads independently and cannot rely on another command file's
// helpers).
function ppbAddToRenderQueueRangeToWorkAreaType(range) {
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

function ppb_addToRenderQueue(argsJson) {
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

    var rangeInfo = ppbAddToRenderQueueRangeToWorkAreaType(args.range);
    if (!rangeInfo) {
      return JSON.stringify({ ok: false, error: "range must be one of \"entire\", \"in-to-out\", \"work-area\"" });
    }

    var presetFile = new File(args.presetPath);
    if (!presetFile.exists) {
      return JSON.stringify({ ok: false, error: "preset file not found: " + args.presetPath });
    }

    var startBatch = args.startBatch === true;

    if (!app.encoder) {
      return JSON.stringify({ ok: false, error: "Adobe Media Encoder is not available (app.encoder is undefined)" });
    }

    try {
      app.encoder.launchEncoder();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.encoder.launchEncoder() failed: " + e.toString() });
    }

    try {
      app.encoder.encodeSequence(seq, args.outputPath, args.presetPath, rangeInfo.value, 1 /* removeOnCompletion */);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.encoder.encodeSequence() failed: " + e.toString() });
    }

    if (startBatch) {
      try {
        app.encoder.startBatch();
      } catch (e) {
        return JSON.stringify({ ok: false, error: "job was queued but app.encoder.startBatch() failed: " + e.toString() });
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        outputPath: args.outputPath,
        presetPath: args.presetPath,
        range: rangeInfo.label,
        startBatch: startBatch,
        note: "fire-and-forget: the job is queued in Adobe Media Encoder, not exported synchronously — " +
          "there is no progress API, so this result does NOT confirm the output file exists yet. " +
          "Poll outputPath yourself, or leave startBatch false and trigger the batch manually in AME."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
