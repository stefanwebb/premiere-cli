// Command: close-sequence → ppb_closeSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's advanced.ts close_sequence
// tool: `seq.close()` per PREMIERE_API_NOTES.md's Sequences table.
//
// UI-TAB SEMANTICS PROBE: seq.close() is expected to close the sequence's
// TAB in the Timeline panel, not delete the sequence from the project —
// there is a separate app.project.deleteSequence(seq) for that. This
// command probes exactly that distinction rather than assuming it: after
// calling close(), it re-scans app.project.sequences (a collection
// distinct from open timeline tabs) for the closed sequence's own
// sequenceID and reports stillInProjectSequences accordingly.
function ppb_closeSequence(argsJson) {
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

    var closedName = seq.name;
    var closedSequenceID = null;
    try { closedSequenceID = seq.sequenceID; } catch (e) { closedSequenceID = null; }

    var numSequencesBefore = app.project.sequences.numSequences;

    try {
      seq.close();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "seq.close() failed: " + e.toString() });
    }

    var numSequencesAfter = app.project.sequences.numSequences;
    var stillInProjectSequences = false;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      var candidateId = null;
      try { candidateId = app.project.sequences[i].sequenceID; } catch (e2) { candidateId = null; }
      if (candidateId !== null && candidateId === closedSequenceID) {
        stillInProjectSequences = true;
        break;
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: closedName,
        sequenceID: closedSequenceID,
        closed: true,
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter,
        stillInProjectSequences: stillInProjectSequences,
        note: "seq.close() closes the sequence's UI TAB in the Timeline panel — this is NOT the same as deleting the sequence from the project (that is app.project.deleteSequence(seq), not exposed by this command). stillInProjectSequences reports whether app.project.sequences — a collection distinct from open timeline tabs — still lists the closed sequence afterward, the only available probe of this UI-tab-vs-project-item distinction."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
