// Command: import-sequences-from-project → ppb_importSequencesFromProject
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts
// import_sequences. Calls app.project.importSequences(prprojPath,
// [seqIds]) per PREMIERE_API_NOTES.md's Sequences table; if sequenceIds
// is omitted, calls the one-arg form (documented by the reference tool
// as "imports all sequences"). File-exists check on projectPath first,
// same cheap guard as open-project.jsx. Verified by a project sequence-
// count increase (never trusting the call's own return value) — cannot
// name which sequences were imported beyond that (importSequences has no
// documented return value naming them).

function ppb_importSequencesFromProject(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.projectPath || typeof args.projectPath !== "string") {
      return JSON.stringify({ ok: false, error: "projectPath is required" });
    }

    var file = new File(args.projectPath);
    if (!file.exists) {
      return JSON.stringify({ ok: false, error: "no file exists at projectPath: " + args.projectPath });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    if (typeof app.project.importSequences !== "function") {
      return JSON.stringify({ ok: false, error: "importSequences is not available on this Premiere build" });
    }

    var hasIds = Object.prototype.toString.call(args.sequenceIds) === "[object Array]" && args.sequenceIds.length > 0;

    var countBefore = app.project.sequences.numSequences;

    try {
      if (hasIds) {
        app.project.importSequences(args.projectPath, args.sequenceIds);
      } else {
        app.project.importSequences(args.projectPath);
      }
    } catch (e) {
      return JSON.stringify({ ok: false, error: "importSequences() failed: " + e.toString() });
    }

    var countAfter = app.project.sequences.numSequences;
    var imported = countAfter > countBefore;

    if (!imported) {
      return JSON.stringify({
        ok: false,
        error: "importSequences() did not throw, but the project's sequence count did not increase",
        countBefore: countBefore,
        countAfter: countAfter
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        imported: true,
        projectPath: args.projectPath,
        sequenceIds: hasIds ? args.sequenceIds : null,
        allSequences: !hasIds,
        countBefore: countBefore,
        countAfter: countAfter
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
