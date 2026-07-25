// Command: batch-add-transitions → ppb_batchAddTransitions
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// activateSequenceForQE, qeFindNthNonEmptyClip, ppbApplyTransitionToClip,
// ...) are already defined there.
//
// Port of the reference project's batch_add_transitions, generalized from
// its fixed "at every cut point on a track" behavior to the same atEnd
// semantic as add-transition: applies the SAME transition to every clip
// on one video OR audio track (default atEnd: true, i.e. at each clip's end/the
// cut point between it and its successor — matching the reference tool's
// own loop). Capped at 100 clips per call. Reuses the shared
// ppbApplyTransitionToClip helper per clip, so the disputed addTransition
// signature and transitions-count verification are identical to
// add-transition's — see that file's header and PREMIERE_API_NOTES.md's
// "Transitions (QE only)" section.
var PPB_BATCH_ADD_TRANSITIONS_CAP = 100;

function ppb_batchAddTransitions(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var trackType = args.trackType || "video";
    if (trackType !== "video" && trackType !== "audio") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" or \"audio\"" });
    }
    var isAudio = trackType === "audio";
    var trackIndex = 0;
    if (typeof args.trackIndex === "number") {
      if (args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
        return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
      }
      trackIndex = args.trackIndex;
    }
    var atEnd = true;
    if (typeof args.atEnd === "boolean") {
      atEnd = args.atEnd;
    } else if (args.atEnd !== undefined && args.atEnd !== null) {
      return JSON.stringify({ ok: false, error: "atEnd must be a boolean if given (default true)" });
    }
    var transitionName = null;
    if (typeof args.transitionName === "string" && args.transitionName.length > 0) {
      transitionName = args.transitionName;
    } else if (args.transitionName !== undefined && args.transitionName !== null) {
      return JSON.stringify({ ok: false, error: "transitionName must be a non-empty string, or omitted/null for the default transition" });
    }
    // Same substitution as add-transition: the null-transition ("default")
    // form no-throws but adds NOTHING on this build, so name Premiere's
    // factory default for the track type explicitly.
    if (transitionName === null) {
      transitionName = isAudio ? "Constant Power" : "Cross Dissolve";
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

    var numTracks;
    var trackCollection = isAudio ? seq.audioTracks : seq.videoTracks;
    try { numTracks = trackCollection.numTracks; } catch (eNt) { numTracks = 0; }
    if (trackIndex >= numTracks) {
      return JSON.stringify({ ok: false, error: "trackIndex " + trackIndex + " is out of range — sequence has " + numTracks + " video track(s)" });
    }
    var numClips;
    try { numClips = trackCollection[trackIndex].clips.numItems; } catch (eNc) { numClips = 0; }
    if (numClips < 2) {
      return JSON.stringify({ ok: true, result: { sequenceName: seq.name, trackType: trackType, trackIndex: trackIndex, totalClipsOnTrack: numClips, attempted: 0, succeeded: 0, cappedAtLimit: false, results: [] } });
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
        if (isAudio) {
          if (qe.project.getAudioTransitionByName) {
            transitionQE = qe.project.getAudioTransitionByName(transitionName);
          }
        } else if (qe.project.getVideoTransitionByName) {
          transitionQE = qe.project.getVideoTransitionByName(transitionName);
        }
      } catch (e3) {
        transitionQE = null;
      }
      if (!transitionQE) {
        return JSON.stringify({ ok: false, error: "transition not found: \"" + transitionName + "\" (try list-available-" + (isAudio ? "audio-" : "") + "transitions)" });
      }
    }

    // One transition per cut point: clips 0..numClips-2 (the last clip has
    // no successor to transition into), same range the reference tool's
    // own loop uses.
    var cutPointCount = numClips - 1;
    var cappedAtLimit = cutPointCount > PPB_BATCH_ADD_TRANSITIONS_CAP;
    var attemptCount = cappedAtLimit ? PPB_BATCH_ADD_TRANSITIONS_CAP : cutPointCount;

    var results = [];
    var succeeded = 0;
    for (var c = 0; c < attemptCount; c++) {
      var applyResult = ppbApplyTransitionToClip(seq, trackType, trackIndex, c, transitionQE, atEnd, durationSeconds);
      results.push({
        clipIndex: c,
        clipName: applyResult.clipName,
        previousTransitionCount: applyResult.previousCount,
        newTransitionCount: applyResult.newCount,
        addedTransitionName: applyResult.addedTransitionName,
        verified: applyResult.verified,
        succeededWithArgs: applyResult.succeededWithArgs,
        error: applyResult.verified ? null : applyResult.error
      });
      if (applyResult.verified) {
        succeeded++;
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: "video",
        trackIndex: trackIndex,
        transitionName: transitionName,
        atEnd: atEnd,
        durationSeconds: durationSeconds,
        totalClipsOnTrack: numClips,
        attempted: attemptCount,
        succeeded: succeeded,
        cappedAtLimit: cappedAtLimit,
        results: results
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
