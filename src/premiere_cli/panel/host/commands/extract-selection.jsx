// Command: extract-selection → ppb_extractSelection
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, activateSequenceForQE, ...) are already defined
// there.
//
// Ported from leancoderkavy/premiere-pro-mcp's utility.ts
// extract_selection. Extracts (removes AND closes the gap, i.e.
// ripple-removes) the content between the sequence's in/out points via
// QE `qeSeq.extract()` — same three-point-edit family as lift-selection,
// QE-only (no standard-DOM API per PREMIERE_API_NOTES.md).
//
// Destructive: extracted content cannot be restored (undo is
// non-functional on this build per README.md) — verify on a
// duplicate/throwaway sequence before running against real footage.
//
// Verification: total clip count across all tracks, before/after — a
// successful extract should DROP the count (content removed, gap
// closed), the opposite expectation from lift-selection.
function ppb_countAllClipsExtractSelection(seq) {
  var total = 0;
  try {
    for (var v = 0; v < seq.videoTracks.numTracks; v++) {
      total += seq.videoTracks[v].clips.numItems;
    }
  } catch (e) {
    // best-effort
  }
  try {
    for (var a = 0; a < seq.audioTracks.numTracks; a++) {
      total += seq.audioTracks[a].clips.numItems;
    }
  } catch (e) {
    // best-effort
  }
  return total;
}

function ppb_extractSelection(argsJson) {
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

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() returned nothing after activating the sequence" });
    }

    var countBefore = ppb_countAllClipsExtractSelection(seq);

    try {
      qeSeq.extract();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qeSeq.extract() failed: " + e.toString(), countBefore: countBefore });
    }

    var countAfter = ppb_countAllClipsExtractSelection(seq);

    // Live-tested 2026-07-17: extract() no-throws but removes NOTHING on
    // this build (count unchanged) — a zero drop is a hard failure.
    if (countAfter >= countBefore) {
      return JSON.stringify({
        ok: false,
        error: "extract() no-throws but removed nothing on this build — extract-selection is NON-FUNCTIONAL here; use remove-selected-clips with ripple true instead",
        countBefore: countBefore,
        countAfter: countAfter
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        extracted: true,
        countBefore: countBefore,
        countAfter: countAfter,
        verified: true
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
