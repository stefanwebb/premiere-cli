// Command: create-subsequence → ppb_createSubsequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's sequence.ts create_subsequence
// tool: `seq.createSubsequence(ignoreTrackTargetingBool)` per
// PREMIERE_API_NOTES.md's Sequences table. Distinct from nest-clips.jsx
// (wave 5), which wraps the SAME underlying API but additionally requires
// and reports a clip selection and supports renaming the result — this
// command is the more direct 1:1 port of the reference tool: it does not
// enforce a selection precondition (selectedClipCount is reported for
// information only) and does not rename the new sequence.
//
// Verification: the sequence count increases by exactly one, and the new
// sequence is identified as whichever sequence appeared that wasn't in the
// "before" snapshot (createSubsequence()'s own return value is not
// trusted, matching every other QE/structural command in this panel).
function ppbCreateSubseq_snapshotIds(project) {
  var ids = {};
  for (var i = 0; i < project.sequences.numSequences; i++) {
    var s = project.sequences[i];
    var id = null;
    try { id = s.sequenceID; } catch (e) { id = null; }
    ids[id !== null ? id : ("idx" + i)] = true;
  }
  return ids;
}

function ppb_createSubsequence(argsJson) {
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
    if (typeof args.ignoreTrackTargeting !== "boolean") {
      return JSON.stringify({ ok: false, error: "ignoreTrackTargeting (boolean) is required" });
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

    var numSequencesBefore = app.project.sequences.numSequences;
    var idsBefore = ppbCreateSubseq_snapshotIds(app.project);

    var createError = null;
    try {
      seq.createSubsequence(args.ignoreTrackTargeting);
    } catch (e) {
      createError = e.toString();
    }

    var numSequencesAfter = app.project.sequences.numSequences;

    if (createError !== null || numSequencesAfter <= numSequencesBefore) {
      return JSON.stringify({
        ok: false,
        error: createError !== null
          ? ("seq.createSubsequence() failed: " + createError)
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

    return JSON.stringify({
      ok: true,
      result: {
        sourceSequenceName: seq.name,
        ignoreTrackTargeting: args.ignoreTrackTargeting,
        selectedClipCount: selectedCount,
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter,
        newSequenceName: newSeq.name,
        newSequenceID: newSeq.sequenceID
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
