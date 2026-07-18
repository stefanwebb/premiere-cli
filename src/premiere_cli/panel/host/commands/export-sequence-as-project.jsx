// Command: export-sequence-as-project → ppb_exportSequenceAsProject
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's advanced.ts
// export_as_project tool: `seq.exportAsProject(outputPath)` per
// PREMIERE_API_NOTES.md's Sequences table. Verified via the filesystem —
// never the call's own (undocumented) return value — same rule as
// export-frame.jsx and every other file-producing command in this panel.
function ppb_exportSequenceAsProject(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    if (!args.outputPath || typeof args.outputPath !== "string") {
      return JSON.stringify({ ok: false, error: "outputPath is required" });
    }

    var seq;
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

    try {
      seq.exportAsProject(args.outputPath);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "seq.exportAsProject() failed: " + e.toString() });
    }

    var outFile = new File(args.outputPath);
    if (!outFile.exists) {
      return JSON.stringify({ ok: false, error: "exportAsProject() did not throw, but no file was found at " + args.outputPath });
    }

    var fileSizeBytes = null;
    try { fileSizeBytes = outFile.length; } catch (e) { fileSizeBytes = null; }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        outputPath: args.outputPath,
        fileSizeBytes: fileSizeBytes
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
