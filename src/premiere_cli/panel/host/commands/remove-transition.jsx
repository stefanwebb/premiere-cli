// Command: remove-transition → ppb_removeTransition
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// NOT a port — no reference repo has a transition-removal tool. Added in
// wave 4 as cleanup for add-transition/batch-add-transitions, since undo
// is confirmed non-functional on this build (see README/undo command).
// Removal is standard-DOM only: track.transitions[i].remove(false, false)
// per PREMIERE_API_NOTES.md's "Transitions (QE only)" line, but the
// remove() ARITY is unconfirmed on this build (0, 1, or 2 args across the
// reference repos) — probed via an attempts array, verified the only
// reliable way available: a numItems drop on track.transitions (never the
// call's own return value). If transitionIndex is out of range, the
// result includes a transitions LISTING (index + best-effort name) so the
// caller can find the right index without a separate round trip.
function ppb_removeTransition(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.trackType !== "video" && args.trackType !== "audio") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" or \"audio\"" });
    }
    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.transitionIndex !== "number" || args.transitionIndex < 0 || Math.floor(args.transitionIndex) !== args.transitionIndex) {
      return JSON.stringify({ ok: false, error: "transitionIndex must be a non-negative integer" });
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

    var trackCollection = args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var numTracks;
    try { numTracks = trackCollection.numTracks; } catch (eNt) { numTracks = 0; }
    if (args.trackIndex >= numTracks) {
      return JSON.stringify({ ok: false, error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " " + args.trackType + " track(s)" });
    }
    var track = trackCollection[args.trackIndex];

    var transitions;
    try {
      transitions = track.transitions;
    } catch (eTr) {
      return JSON.stringify({ ok: false, error: "track.transitions is not available: " + eTr.toString() });
    }
    var numTransitions;
    try { numTransitions = transitions.numItems; } catch (eNi) { numTransitions = null; }
    if (numTransitions === null) {
      return JSON.stringify({ ok: false, error: "could not read track.transitions.numItems on this build" });
    }

    function listTransitions() {
      var list = [];
      for (var i = 0; i < numTransitions; i++) {
        var name = null;
        try { name = transitions[i].name; } catch (eName) {
          try { name = transitions[i].displayName; } catch (eName2) { name = null; }
        }
        list.push({ index: i, name: name });
      }
      return list;
    }

    if (args.transitionIndex >= numTransitions) {
      return JSON.stringify({
        ok: false,
        error: "transitionIndex " + args.transitionIndex + " is out of range — track has " + numTransitions + " transition(s)",
        transitions: listTransitions(),
        count: numTransitions
      });
    }

    var removedTransitionName = null;
    try { removedTransitionName = transitions[args.transitionIndex].name; } catch (eRn) {
      try { removedTransitionName = transitions[args.transitionIndex].displayName; } catch (eRn2) { removedTransitionName = null; }
    }

    var previousCount = numTransitions;
    var attempts = [];
    var verified = false;
    var newCount = null;

    function attemptRemove(label, fn) {
      if (verified) {
        return;
      }
      var entry = { form: label };
      try {
        fn();
        entry.success = true;
      } catch (eCall) {
        entry.success = false;
        entry.error = eCall.toString();
        attempts.push(entry);
        return;
      }
      var count = null;
      try { count = track.transitions.numItems; } catch (eCount) { count = null; }
      if (count !== null && count === previousCount - 1) {
        entry.verifiedCount = count;
        verified = true;
        newCount = count;
      } else {
        entry.note = "call did not throw, but transitions count did not drop by exactly one — treating as unverified";
      }
      attempts.push(entry);
    }

    attemptRemove("remove(false, false)", function () {
      track.transitions[args.transitionIndex].remove(false, false);
    });
    attemptRemove("remove(false)", function () {
      track.transitions[args.transitionIndex].remove(false);
    });
    attemptRemove("remove()", function () {
      track.transitions[args.transitionIndex].remove();
    });
    attemptRemove("remove(true, false)", function () {
      track.transitions[args.transitionIndex].remove(true, false);
    });

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      transitionIndex: args.transitionIndex,
      removedTransitionName: removedTransitionName,
      previousCount: previousCount,
      newCount: newCount,
      verified: verified,
      attempts: attempts
    };

    if (!verified) {
      result.transitions = listTransitions();
      return JSON.stringify({ ok: false, error: "could not remove the transition with any known argument form — see attempts", result: result });
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
