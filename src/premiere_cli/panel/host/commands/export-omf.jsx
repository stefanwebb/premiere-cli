// Command: export-omf → ppb_exportOmf
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Exports the given (or active) sequence as an OMF file via
// app.project.exportOMF(seq, path, title, rate, bits, encapsulated01,
// audioFileFormat, trim01, handleFrames) (PREMIERE_API_NOTES.md's "FCP XML
// / AAF / OMF / EDL" line). Argument order/defaults mirror the reference
// tool this ports (leancoderkavy's premiere-pro-mcp export_omf) — this
// specific 9-arg signature is UNCONFIRMED against our own Premiere build
// (never live-tested), so a thrown "wrong number/type of arguments" error
// here would indicate the real signature differs.

function ppb_exportOmf(argsJson) {
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

    var title = typeof args.title === "string" ? args.title : "OMFTitle";
    var rate = typeof args.rate === "number" ? args.rate : 48000;
    var bits = typeof args.bits === "number" ? args.bits : 16;
    var audioEncapsulated = args.audioEncapsulated !== false; // default true
    var audioFileFormat = typeof args.audioFileFormat === "number" ? args.audioFileFormat : 1; // 0=AIFF, 1=WAV
    var trimAudioFiles = args.trimAudioFiles !== false; // default true
    var handleFrames = typeof args.handleFrames === "number" ? args.handleFrames : 1000;

    var result = {
      sequenceName: seq.name,
      outputPath: args.outputPath,
      title: title,
      rate: rate,
      bits: bits,
      audioEncapsulated: audioEncapsulated,
      audioFileFormat: audioFileFormat,
      trimAudioFiles: trimAudioFiles,
      handleFrames: handleFrames
    };

    try {
      app.project.exportOMF(
        seq,
        args.outputPath,
        title,
        rate,
        bits,
        audioEncapsulated ? 1 : 0,
        audioFileFormat,
        trimAudioFiles ? 1 : 0,
        handleFrames
      );
    } catch (e) {
      return JSON.stringify({ ok: false, error: "exportOMF failed: " + e.toString() });
    }

    var outFile = new File(args.outputPath);
    if (!outFile.exists) {
      return JSON.stringify({
        ok: false,
        error: "exportOMF ran but no file was written to " + args.outputPath
      });
    }

    result.fileSizeBytes = outFile.length;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
