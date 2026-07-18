// Command: get-export-file-extension → ppb_getExportFileExtension
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's sequence.ts
// get_export_file_extension. Standard DOM only — no QE needed.
function ppb_getExportFileExtension(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.presetPath !== "string" || args.presetPath.length === 0) {
      return JSON.stringify({ ok: false, error: "presetPath (string) is required" });
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

    var extension = null;
    try {
      extension = seq.getExportFileExtension(args.presetPath);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read export file extension: " + e.toString() });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        presetPath: args.presetPath,
        extension: extension
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
