// Command: lift-selection → ppb_liftSelection
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, activateSequenceForQE, ...) are already defined
// there.
//
// Ported from leancoderkavy/premiere-pro-mcp's utility.ts lift_selection.
// Lifts (removes WITHOUT closing the gap) the content between the
// sequence's in/out points via QE `qeSeq.lift()` — a three-point-edit
// primitive with no standard-DOM equivalent (see PREMIERE_API_NOTES.md's
// "Clips / TrackItems" section: ripple/roll/slip/slide have no standard-
// DOM API, QE is the only path). Requires sequence in/out points to be
// set first (e.g. via set-sequence-in-out) — an unset range is Premiere's
// own concern, not validated here.
//
// Destructive: lifted content cannot be restored (undo is non-functional
// on this build per README.md) — verify on a duplicate/throwaway sequence
// before running against real footage.
//
// Verification: total clip count across all tracks, before/after — a
// successful lift should leave the SAME clip count (gap opens where
// content was, nothing ripples away) unlike extract-selection, which
// should drop it.
function ppb_countAllClipsLiftSelection(seq) {
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

function ppb_liftSelection(argsJson) {
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

    var countBefore = ppb_countAllClipsLiftSelection(seq);

    try {
      qeSeq.lift();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qeSeq.lift() failed: " + e.toString(), countBefore: countBefore });
    }

    var countAfter = ppb_countAllClipsLiftSelection(seq);

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        lifted: true,
        countBefore: countBefore,
        countAfter: countAfter,
        note: "lift() has no confirmed error signal beyond not throwing; countBefore/countAfter should be equal for a successful lift (gap opened, no ripple) — a drop indicates it behaved like extract instead"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
