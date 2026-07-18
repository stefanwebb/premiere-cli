// Command: duplicate-sequence → ppb_duplicateSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's sequence.ts duplicate_sequence
// tool. Duplicates a sequence via `seq.clone()` per PREMIERE_API_NOTES.md's
// Sequences table. clone() gives the copy a Premiere-generated default name
// (there is no confirmed API to pass a name directly to it) — this command
// renames the resulting sequence (and its Project-panel item, per the
// "renaming gotcha" documented alongside seq.clone() in
// PREMIERE_API_NOTES.md — seq.name = x does NOT propagate to the panel)
// afterward, same pattern as nest-clips.jsx.
//
// Verification: the sequence count increases by exactly one, and the new
// sequence is identified as whichever sequence appeared that wasn't in the
// "before" snapshot (clone()'s own return value is not trusted, matching
// every other QE/structural command in this panel).
function ppbDupSeq_snapshotIds(project) {
  var ids = {};
  for (var i = 0; i < project.sequences.numSequences; i++) {
    var s = project.sequences[i];
    var id = null;
    try { id = s.sequenceID; } catch (e) { id = null; }
    ids[id !== null ? id : ("idx" + i)] = true;
  }
  return ids;
}

function ppb_duplicateSequence(argsJson) {
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
    if (!args.newName || typeof args.newName !== "string") {
      return JSON.stringify({ ok: false, error: "newName is required" });
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

    var numSequencesBefore = app.project.sequences.numSequences;
    var idsBefore = ppbDupSeq_snapshotIds(app.project);

    var cloneError = null;
    try {
      seq.clone();
    } catch (e) {
      cloneError = e.toString();
    }

    var numSequencesAfter = app.project.sequences.numSequences;

    if (cloneError !== null || numSequencesAfter <= numSequencesBefore) {
      return JSON.stringify({
        ok: false,
        error: cloneError !== null
          ? ("seq.clone() failed: " + cloneError)
          : "clone() did not throw, but the project's sequence count did not increase",
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter
      });
    }

    var newSeq = null;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      var candidate = app.project.sequences[i];
      var candidateId = null;
      try { candidateId = candidate.sequenceID; } catch (e) { candidateId = null; }
      var key = candidateId !== null ? candidateId : ("idx" + i);
      if (!idsBefore[key]) {
        newSeq = candidate;
        break;
      }
    }

    if (!newSeq) {
      return JSON.stringify({
        ok: false,
        error: "sequence count increased but the cloned sequence could not be identified",
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter
      });
    }

    var previousName = null;
    try { previousName = newSeq.name; } catch (e) { previousName = null; }

    var renameNote = null;
    try {
      newSeq.name = args.newName;
    } catch (e) {
      renameNote = "renaming the sequence object failed: " + e.toString();
    }
    // "renaming gotcha" per PREMIERE_API_NOTES.md: seq.name = x does not
    // propagate to the Project panel item — find and rename it too.
    try {
      var rootChildren = app.project.rootItem.children;
      for (var ri = 0; ri < rootChildren.numItems; ri++) {
        var it = rootChildren[ri];
        var itSeq = null;
        try { itSeq = it.getSequence ? it.getSequence() : null; } catch (e2) { itSeq = null; }
        if (itSeq && itSeq.sequenceID === newSeq.sequenceID) {
          it.name = args.newName;
          break;
        }
      }
    } catch (e3) {
      // best-effort — panel-item rename is a bonus, not required for success
    }

    var readBackName = null;
    try { readBackName = newSeq.name; } catch (e4) { readBackName = null; }
    var renamed = readBackName === args.newName;

    return JSON.stringify({
      ok: true,
      result: {
        sourceSequenceName: seq.name,
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter,
        previousDefaultName: previousName,
        newSequenceName: newSeq.name,
        newSequenceID: newSeq.sequenceID,
        requestedName: args.newName,
        renamed: renamed,
        renameNote: renameNote
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
