// Command: export-aaf → ppb_exportAaf
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Exports the given (or active) sequence as an AAF file via
// seq.exportAsAAF(path, mixdown01, mono01, rate, bits)
// (PREMIERE_API_NOTES.md's "FCP XML / AAF / OMF / EDL" line) — synchronous,
// no AME dependency. Defaults mirror the reference tool this ports
// (leancoderkavy's premiere-pro-mcp export_aaf): mixdown=true,
// explodeToMono=false, sampleRate=48000, bitsPerSample=16.

function ppb_exportAaf(argsJson) {
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

    var mixdown = args.mixdown !== false; // default true
    var mono = args.mono === true; // default false
    var rate = typeof args.rate === "number" ? args.rate : 48000;
    var bits = typeof args.bits === "number" ? args.bits : 16;

    var result = {
      sequenceName: seq.name,
      outputPath: args.outputPath,
      mixdown: mixdown,
      mono: mono,
      rate: rate,
      bits: bits
    };

    try {
      seq.exportAsAAF(args.outputPath, mixdown ? 1 : 0, mono ? 1 : 0, rate, bits);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "exportAsAAF failed: " + e.toString() });
    }

    var outFile = new File(args.outputPath);
    if (!outFile.exists) {
      return JSON.stringify({
        ok: false,
        error: "exportAsAAF ran but no file was written to " + args.outputPath
      });
    }

    result.fileSizeBytes = outFile.length;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
