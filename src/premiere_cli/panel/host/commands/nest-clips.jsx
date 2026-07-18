// Command: nest-clips → ppb_nestClips
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's utility.ts nest_clips.
// Nests the CURRENTLY SELECTED clips into a new nested sequence via
// `seq.createSubsequence(ignoreTrackTargetingBool)` per
// PREMIERE_API_NOTES.md's Sequences table (selection is a precondition —
// select clips first, e.g. via select-clips-by-name/select-all-clips).
// createSubsequence() itself gives the new sequence a Premiere-generated
// default name; there is no confirmed API to pass a name directly to it,
// so this command renames the resulting sequence (and its Project-panel
// item, per the "renaming gotcha" documented alongside seq.clone() in
// PREMIERE_API_NOTES.md — seq.name = x does NOT propagate to the panel)
// afterward if `name` was given.
//
// Semi-destructive (restructures the timeline): the selected clips are
// replaced by one nested-sequence clip. Undo is non-functional on this
// build per README.md.
//
// Verification: the sequence count increases by exactly one, and the new
// sequence is identified as whichever sequence appeared that wasn't in
// the "before" snapshot (createSubsequence()'s own return value is not
// trusted, matching every other QE/structural command in this panel).
function ppb_snapshotSequenceIds(project) {
  var ids = {};
  for (var i = 0; i < project.sequences.numSequences; i++) {
    var s = project.sequences[i];
    var id = null;
    try { id = s.sequenceID; } catch (e) { id = null; }
    ids[id !== null ? id : ("idx" + i)] = true;
  }
  return ids;
}

function ppb_nestClips(argsJson) {
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
    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
    }

    var selectedCount = 0;
    function countSelected(tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        for (var c = 0; c < tracks[t].clips.numItems; c++) {
          var isSel = false;
          try { isSel = tracks[t].clips[c].isSelected(); } catch (e) { isSel = false; }
          if (isSel) {
            selectedCount++;
          }
        }
      }
    }
    countSelected(seq.videoTracks);
    countSelected(seq.audioTracks);

    if (selectedCount === 0) {
      return JSON.stringify({ ok: false, error: "no clips selected — select clips first (e.g. select-clips-by-name/select-clips-in-range)" });
    }

    var numSequencesBefore = app.project.sequences.numSequences;
    var idsBefore = ppb_snapshotSequenceIds(app.project);

    var createError = null;
    try {
      seq.createSubsequence(true);
    } catch (e) {
      createError = e.toString();
    }

    var numSequencesAfter = app.project.sequences.numSequences;

    if (createError !== null || numSequencesAfter <= numSequencesBefore) {
      return JSON.stringify({
        ok: false,
        error: createError !== null
          ? ("seq.createSubsequence(true) failed: " + createError)
          : "createSubsequence() did not throw, but the project's sequence count did not increase",
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
        error: "sequence count increased but the new sequence could not be identified",
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter
      });
    }

    var previousName = null;
    try { previousName = newSeq.name; } catch (e) { previousName = null; }

    var renamed = false;
    var renameNote = null;
    if (args.name && typeof args.name === "string") {
      try {
        newSeq.name = args.name;
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
            it.name = args.name;
            break;
          }
        }
      } catch (e3) {
        // best-effort — panel-item rename is a bonus, not required for success
      }
      var readBackName = null;
      try { readBackName = newSeq.name; } catch (e4) { readBackName = null; }
      renamed = readBackName === args.name;
    }

    return JSON.stringify({
      ok: true,
      result: {
        sourceSequenceName: seq.name,
        selectedClipCount: selectedCount,
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter,
        newSequenceName: newSeq.name,
        newSequenceID: newSeq.sequenceID,
        previousDefaultName: previousName,
        requestedName: args.name || null,
        renamed: renamed,
        renameNote: renameNote
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
