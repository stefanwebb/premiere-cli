// Command: encode-file → ppb_encodeFile
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Queues an EXTERNAL file (not a project item, not a sequence — a path on
// disk not necessarily imported into this project at all) for export in
// Adobe Media Encoder via app.encoder.launchEncoder() + encodeFile() +
// startBatch(), mirroring the reference tool this ports (leancoderkavy's
// premiere-pro-mcp encode_file). **Fire-and-forget** — same no-progress-API
// caveat as add-to-render-queue/encode-project-item: encodeFile() returns
// as soon as the job is queued, so this command cannot verify the output
// file exists.

function ppb_encodeFile(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.inputPath || typeof args.inputPath !== "string") {
      return JSON.stringify({ ok: false, error: "inputPath is required" });
    }
    if (!args.outputPath || typeof args.outputPath !== "string") {
      return JSON.stringify({ ok: false, error: "outputPath is required" });
    }
    if (!args.presetPath || typeof args.presetPath !== "string") {
      return JSON.stringify({ ok: false, error: "presetPath is required (an absolute .epr file path)" });
    }

    var inputFile = new File(args.inputPath);
    if (!inputFile.exists) {
      return JSON.stringify({ ok: false, error: "input file not found: " + args.inputPath });
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
      // Matches the reference tool's own call shape: encodeFile(input,
      // output, preset, removeOnCompletion01, srcIn, srcOut) — srcIn/srcOut
      // are left undefined here (this command takes no in/out-point args
      // per spec), encoding the entire input file.
      app.encoder.encodeFile(args.inputPath, args.outputPath, args.presetPath, 1 /* removeOnCompletion */);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.encoder.encodeFile() failed: " + e.toString() });
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
        inputPath: args.inputPath,
        outputPath: args.outputPath,
        presetPath: args.presetPath,
        startBatch: startBatch,
        note: "fire-and-forget: the job is queued in Adobe Media Encoder, not exported synchronously — " +
          "there is no progress API, so this result does NOT confirm the output file exists yet."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
