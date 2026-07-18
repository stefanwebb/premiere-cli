// Command: export-fcp-xml → ppb_exportFcpXml
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Exports the given (or active) sequence as a Final Cut Pro XML file via
// seq.exportAsFinalCutProXML(path) (PREMIERE_API_NOTES.md's "FCP XML / AAF
// / OMF / EDL" line) — synchronous, no AME dependency.

function ppb_exportFcpXml(argsJson) {
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

    var result = {
      sequenceName: seq.name,
      outputPath: args.outputPath
    };

    try {
      seq.exportAsFinalCutProXML(args.outputPath);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "exportAsFinalCutProXML failed: " + e.toString() });
    }

    var outFile = new File(args.outputPath);
    if (!outFile.exists) {
      return JSON.stringify({
        ok: false,
        error: "exportAsFinalCutProXML ran but no file was written to " + args.outputPath
      });
    }

    result.fileSizeBytes = outFile.length;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
