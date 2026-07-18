// Command: add-transition → ppb_addTransition
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// activateSequenceForQE, qeFindNthNonEmptyClip, ppbApplyTransitionToClip,
// ...) are already defined there.
//
// Merges the reference project's add_transition (track+cut-point
// addressing) and add_transition_to_clip (node_id+position addressing)
// into one command, addressed the same way as get-full-clip-info
// (trackType/trackIndex/clipIndex) rather than either reference's own
// scheme — video-only (no reference repo demonstrates an audio-transition
// "add" API). `atEnd: true` applies the transition at the clip's end
// (matching add_transition_to_clip's "end" position and the cut-point
// between this clip and its successor); `atEnd: false` applies it at the
// clip's start. The reference's "both" position is intentionally dropped
// — call this command twice (once per atEnd value) to reproduce it.
// `transitionName` omitted/null = the default transition, per ayushozha's
// addTransition(null, true, "1.0") convention. All the actual apply-and-
// verify work (disputed addTransition signature, transitions-count
// verification) lives in the shared ppbApplyTransitionToClip helper.
function ppb_addTransition(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.trackType !== "video") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" — no reference API demonstrates adding a transition to an audio track" });
    }
    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.clipIndex !== "number" || args.clipIndex < 0 || Math.floor(args.clipIndex) !== args.clipIndex) {
      return JSON.stringify({ ok: false, error: "clipIndex must be a non-negative integer" });
    }
    if (typeof args.atEnd !== "boolean") {
      return JSON.stringify({ ok: false, error: "atEnd must be a boolean (true = end of clip, false = start of clip)" });
    }
    var transitionName = null;
    if (typeof args.transitionName === "string" && args.transitionName.length > 0) {
      transitionName = args.transitionName;
    } else if (args.transitionName !== undefined && args.transitionName !== null) {
      return JSON.stringify({ ok: false, error: "transitionName must be a non-empty string, or omitted/null for the default transition" });
    }

    // Live-tested 2026-07-17: the null-transition ("default") form
    // no-throws but adds NOTHING on this build, while a NAMED transition
    // works and verifies. Substitute Cross Dissolve (Premiere's factory
    // default) rather than burning attempts on a known-dead path.
    if (transitionName === null) {
      transitionName = "Cross Dissolve";
    }
    var durationSeconds = 1.0;
    if (typeof args.durationSeconds === "number") {
      if (args.durationSeconds <= 0) {
        return JSON.stringify({ ok: false, error: "durationSeconds must be a positive number" });
      }
      durationSeconds = args.durationSeconds;
    } else if (args.durationSeconds !== undefined && args.durationSeconds !== null) {
      return JSON.stringify({ ok: false, error: "durationSeconds must be a number" });
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
    } catch (e2) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e2.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var transitionQE = null;
    if (transitionName !== null) {
      try {
        if (qe.project.getVideoTransitionByName) {
          transitionQE = qe.project.getVideoTransitionByName(transitionName);
        }
      } catch (e3) {
        transitionQE = null;
      }
      if (!transitionQE) {
        return JSON.stringify({ ok: false, error: "transition not found: \"" + transitionName + "\" (try list-available-transitions)" });
      }
    }

    var applyResult = ppbApplyTransitionToClip(seq, args.trackIndex, args.clipIndex, transitionQE, args.atEnd, durationSeconds);

    var result = {
      sequenceName: seq.name,
      trackType: "video",
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: applyResult.clipName,
      transitionName: transitionName,
      atEnd: args.atEnd,
      durationSeconds: durationSeconds,
      previousTransitionCount: applyResult.previousCount,
      newTransitionCount: applyResult.newCount,
      addedTransitionName: applyResult.addedTransitionName,
      verified: applyResult.verified,
      attempts: applyResult.attempts,
      succeededWithArgs: applyResult.succeededWithArgs
    };

    if (!applyResult.verified) {
      return JSON.stringify({ ok: false, error: applyResult.error, result: result });
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
