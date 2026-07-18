// Command: debug-qe-try-mutate → ppb_debugQeTryMutate
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// TEMPORARY / EXPERIMENTAL — mutation test, not a supported panel feature.
// Reflection (see ppb_debugQeInspect) revealed method NAMES on QE Clip
// objects (remove, move, moveToTrack, ...) but no signatures — every
// method's .reflect description/parameters came back empty on this build.
// This tries a short list of plausible argument counts for `remove` and
// `moveToTrack` against real clips and reports what happened, so the real
// signature can be inferred from behavior instead of guessed blind.
//
// SAFETY GUARD: only runs if the *active* sequence's name exactly matches
// args.sequenceName. Point this at a duplicate/throwaway sequence, never
// at real project media — a wrong guess could ripple-shift or delete
// clips on whatever sequence is active.
function scanAudioClips(qeSeq, numAudioTracks) {
  var clips = [];
  var emptyTrackIndices = [];

  for (var t = 0; t < numAudioTracks; t++) {
    var track = qeSeq.getAudioTrackAt(t);
    var numItems = track.numItems;
    var allEmpty = true;

    for (var i = 0; i < numItems; i++) {
      var item = track.getItemAt(i);
      if (item.type !== "Empty") {
        allEmpty = false;
        clips.push({ trackIndex: t, itemIndex: i, name: item.name, item: item });
      }
    }

    if (allEmpty) {
      emptyTrackIndices.push(t);
    }
  }

  return { clips: clips, emptyTrackIndices: emptyTrackIndices };
}

function describeAudioTrack(qeSeq, trackIndex) {
  var track = qeSeq.getAudioTrackAt(trackIndex);
  var items = [];
  for (var i = 0; i < track.numItems; i++) {
    var item = track.getItemAt(i);
    items.push({ index: i, type: item.type, name: item.type !== "Empty" ? item.name : "" });
  }
  return items;
}

function tryCallGuesses(fn, thisArg, guesses) {
  var attempts = [];
  var succeededWithArgs = null;

  for (var g = 0; g < guesses.length; g++) {
    var callArgs = guesses[g];
    try {
      fn.apply(thisArg, callArgs);
      attempts.push({ args: describeArgsForLog(callArgs), success: true });
      succeededWithArgs = describeArgsForLog(callArgs);
      break;
    } catch (e) {
      attempts.push({ args: describeArgsForLog(callArgs), success: false, error: e.toString() });
    }
  }

  return { attempts: attempts, succeededWithArgs: succeededWithArgs };
}

function describeArgsForLog(callArgs) {
  var described = [];
  for (var i = 0; i < callArgs.length; i++) {
    var a = callArgs[i];
    if (a && typeof a === "object" && typeof a.numItems !== "undefined") {
      described.push("<Track>");
    } else if (a && typeof a === "object" && typeof a.seconds !== "undefined") {
      described.push("<Time seconds=" + a.seconds + ">");
    } else {
      described.push(a);
    }
  }
  return described;
}

function ppb_debugQeTryMutate(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.sequenceName || typeof args.sequenceName !== "string") {
      return JSON.stringify({ ok: false, error: "sequenceName is required (safety guard — must exactly match the active sequence's name)" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    try {
      ensureQEEnabled();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e.toString() });
    }

    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var qeSeq;
    try {
      qeSeq = qe.project.getActiveSequence();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() failed: " + e.toString() });
    }

    if (!qeSeq) {
      return JSON.stringify({ ok: false, error: "no active sequence (open/select a sequence tab in Premiere)" });
    }

    if (qeSeq.name !== args.sequenceName) {
      return JSON.stringify({
        ok: false,
        error: "active sequence is \"" + qeSeq.name + "\", expected \"" + args.sequenceName +
          "\" — select the intended duplicate/test sequence's tab in Premiere before running this"
      });
    }

    var numAudioTracks = qeSeq.numAudioTracks;
    var scan = scanAudioClips(qeSeq, numAudioTracks);

    if (scan.clips.length < 1) {
      return JSON.stringify({
        ok: true,
        result: { note: "no audio clips found on any audio track — nothing to test on", numAudioTracks: numAudioTracks }
      });
    }

    var result = { before: {}, removeTest: null, moveTest: null };
    var skipRemoveTest = args.skipRemoveTest === true;
    var removeTargetTrackIndex = null;

    if (skipRemoveTest) {
      result.removeTest = { skipped: true, reason: "skipRemoveTest was true" };
    } else {
      // --- remove() test ---
      var removeTarget = scan.clips[0];
      removeTargetTrackIndex = removeTarget.trackIndex;
      result.before.removeTarget = { track: removeTarget.trackIndex, item: removeTarget.itemIndex, name: removeTarget.name };

      var removeGuesses = [[], [true], [false], [true, true], [true, false], [false, true]];
      var removeOutcome = tryCallGuesses(removeTarget.item.remove, removeTarget.item, removeGuesses);

      result.removeTest = {
        attempts: removeOutcome.attempts,
        succeededWithArgs: removeOutcome.succeededWithArgs,
        trackAfter: describeAudioTrack(qeSeq, removeTarget.trackIndex)
      };
    }

    // --- moveToTrack() test — pick a clip on a DIFFERENT track than the
    // remove target (if any), so the two tests don't interfere with each
    // other's track-index bookkeeping.
    var moveTarget = null;
    for (var c = 0; c < scan.clips.length; c++) {
      if (scan.clips[c].trackIndex !== removeTargetTrackIndex) {
        moveTarget = scan.clips[c];
        break;
      }
    }

    if (!moveTarget) {
      result.moveTest = { skipped: true, reason: "only one clip (or all clips on the same track) found; need a second clip on a distinct track" };
      return JSON.stringify({ ok: true, result: result });
    }

    result.before.moveTarget = { track: moveTarget.trackIndex, item: moveTarget.itemIndex, name: moveTarget.name };

    var destTrackIndex = null;
    for (var e2 = 0; e2 < scan.emptyTrackIndices.length; e2++) {
      if (scan.emptyTrackIndices[e2] !== moveTarget.trackIndex) {
        destTrackIndex = scan.emptyTrackIndices[e2];
        break;
      }
    }

    if (destTrackIndex === null) {
      result.moveTest = { skipped: true, reason: "no empty audio track available as a safe move destination" };
      return JSON.stringify({ ok: true, result: result });
    }

    var destTrack = qeSeq.getAudioTrackAt(destTrackIndex);

    // Prior runs: Track object at position 0 -> "Illegal Parameter type";
    // plain number at position 0 with <3 total args -> "Not Enough
    // Parameters" (count accepted, so a numeric track index IS the right
    // type there). With >=3 plain-number/boolean args, every guess became
    // "Illegal Parameter type" instead -- count is satisfied but some
    // position now fails type-checking. Likely candidate: a "position"
    // argument wants a real Time object, not a raw number. Try constructing
    // one via the global `Time` class (shared with the standard Premiere
    // DOM) and via reusing the moved clip's own `.start` (already a
    // confirmed-valid QETime instance) in that slot instead of `0`.
    var zeroTime = null;
    try {
      zeroTime = new Time();
      zeroTime.seconds = 0;
    } catch (e) {
      zeroTime = null;
    }

    var clipStartTime = null;
    try {
      clipStartTime = moveTarget.item.start;
    } catch (e) {
      clipStartTime = null;
    }

    var moveGuesses = [];
    if (zeroTime !== null) {
      moveGuesses.push([destTrackIndex, zeroTime, 0]);
      moveGuesses.push([destTrackIndex, zeroTime, true]);
      moveGuesses.push([destTrackIndex, zeroTime, false]);
      moveGuesses.push([moveTarget.trackIndex, destTrackIndex, zeroTime]);
    }
    if (clipStartTime !== null) {
      moveGuesses.push([destTrackIndex, clipStartTime, 0]);
      moveGuesses.push([destTrackIndex, clipStartTime, true]);
      moveGuesses.push([moveTarget.trackIndex, destTrackIndex, clipStartTime]);
    }
    // Fallbacks in case neither Time construction path is available.
    moveGuesses.push([destTrackIndex, 0, 0]);
    moveGuesses.push([destTrackIndex, 0, true]);

    result.moveTest_zeroTimeConstructed = zeroTime !== null;
    result.moveTest_clipStartTimeReadable = clipStartTime !== null;

    var moveOutcome = tryCallGuesses(moveTarget.item.moveToTrack, moveTarget.item, moveGuesses);

    result.moveTest = {
      destTrackIndex: destTrackIndex,
      attempts: moveOutcome.attempts,
      succeededWithArgs: moveOutcome.succeededWithArgs,
      sourceTrackAfter: describeAudioTrack(qeSeq, moveTarget.trackIndex),
      destTrackAfter: describeAudioTrack(qeSeq, destTrackIndex)
    };

    // --- Alternative to moveToTrack(): place a NEW instance of the same
    // source clip directly onto the destination track via Track-level
    // insert()/overwrite(), mirroring the standard DOM's documented
    // Track.insertClip(projectItem, time) / overwriteClip(projectItem, time).
    // Doesn't require moving the existing TrackItem at all.
    var projectItem = null;
    try {
      projectItem = moveTarget.item.getProjectItem();
    } catch (e) {
      result.insertOverwriteTest = { skipped: true, reason: "getProjectItem() failed: " + e.toString() };
      return JSON.stringify({ ok: true, result: result });
    }

    if (!projectItem) {
      result.insertOverwriteTest = { skipped: true, reason: "getProjectItem() returned nothing" };
      return JSON.stringify({ ok: true, result: result });
    }

    var insertGuesses = [
      [projectItem, zeroTime],
      [projectItem, 0],
      [projectItem],
      [projectItem, zeroTime, 0],
      [projectItem, zeroTime, true]
    ];
    var insertOutcome = tryCallGuesses(destTrack.insert, destTrack, insertGuesses);

    var insertResult = {
      attempts: insertOutcome.attempts,
      succeededWithArgs: insertOutcome.succeededWithArgs,
      destTrackAfterInsert: describeAudioTrack(qeSeq, destTrackIndex)
    };

    // Only try overwrite() if insert() didn't already place something —
    // avoids stacking two clips onto the same (short) destination track.
    if (insertOutcome.succeededWithArgs === null) {
      var overwriteGuesses = [
        [projectItem, zeroTime],
        [projectItem, 0],
        [projectItem]
      ];
      var overwriteOutcome = tryCallGuesses(destTrack.overwrite, destTrack, overwriteGuesses);
      insertResult.overwriteAttempts = overwriteOutcome.attempts;
      insertResult.overwriteSucceededWithArgs = overwriteOutcome.succeededWithArgs;
      insertResult.destTrackAfterOverwrite = describeAudioTrack(qeSeq, destTrackIndex);
    }

    result.insertOverwriteTest = insertResult;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
