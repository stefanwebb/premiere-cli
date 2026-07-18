// Command: ripple-delete-clip → ppb_rippleDeleteClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, serializeTrackItem, ...) are already defined there.
//
// **Destructive.** Ripple-deletes ONE clip (removes it and closes the
// gap, shifting later clips earlier) — the single-clip counterpart of
// remove-track-intervals' batch interval removal. Ported from
// leancoderkavy's premiere-pro-mcp `ripple_delete` tool (advanced.ts),
// which calls `qeClip.rippleDelete()` unconditionally and trusts it.
// Per this bridge's MUTATION RULE, success is instead judged the same way
// remove-track-intervals' findAndRemoveInRange does: an actual numItems
// drop on the QE track, with a `remove(bool, bool)` attempts fallback if
// rippleDelete() didn't move the needle (both calls are unreliable in
// practice on this build — neither's own return value nor the absence of
// a thrown exception is trustworthy). Undo is non-functional on this
// build (see README), so there is no way back from this command short of
// re-inserting the clip's source media by hand.

function ppb_rippleDeleteClip(argsJson) {
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
    if (typeof args.clipIndex !== "number" || args.clipIndex < 0 || Math.floor(args.clipIndex) !== args.clipIndex) {
      return JSON.stringify({ ok: false, error: "clipIndex must be a non-negative integer" });
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

    var resolved = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    if (resolved.error) {
      return JSON.stringify({ ok: false, error: resolved.error });
    }
    var before = serializeTrackItem(resolved.clip, args.trackIndex, args.clipIndex);

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e.toString() });
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
    var qeResolved = resolveQeClip(qeSeq, args.trackType, args.trackIndex, args.clipIndex);
    if (qeResolved.error) {
      return JSON.stringify({ ok: false, error: qeResolved.error });
    }
    var qeClip = qeResolved.qeClip;
    var qeTrack = qeResolved.qeTrack;

    var previousItemCount = qeTrack.numItems;
    var removed = false;
    var method = null;

    if (typeof qeClip.rippleDelete === "function") {
      try {
        qeClip.rippleDelete();
      } catch (e) {
        // fall through to the numItems check regardless — this call's
        // own return value/thrown-ness is not trustworthy on this build
      }
      removed = qeTrack.numItems < previousItemCount;
      if (removed) {
        method = "rippleDelete";
      }
    }

    if (!removed && typeof qeClip.remove === "function") {
      // remove()'s two boolean params are undocumented — try plausible
      // combinations, same fallback order as remove-track-intervals.
      var attempts = [[true, false], [true, true], [false, true], [false, false]];
      for (var a = 0; a < attempts.length && !removed; a++) {
        var countBeforeAttempt = qeTrack.numItems;
        try {
          qeClip.remove(attempts[a][0], attempts[a][1]);
        } catch (e) {
          // fall through to the numItems check below regardless
        }
        if (qeTrack.numItems < countBeforeAttempt) {
          removed = true;
          method = "remove(" + attempts[a][0] + ", " + attempts[a][1] + ")";
        }
      }
    }

    var newItemCount = qeTrack.numItems;

    if (!removed) {
      return JSON.stringify({
        ok: false,
        error: "clip could not be ripple-deleted — neither rippleDelete() nor remove() with any boolean combination reduced the QE track's item count",
        result: {
          sequenceName: seq.name,
          trackType: args.trackType,
          trackIndex: args.trackIndex,
          clipIndex: args.clipIndex,
          clip: before,
          previousItemCount: previousItemCount,
          newItemCount: newItemCount
        }
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        removedClip: before,
        method: method,
        previousItemCount: previousItemCount,
        newItemCount: newItemCount,
        verified: newItemCount < previousItemCount
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
