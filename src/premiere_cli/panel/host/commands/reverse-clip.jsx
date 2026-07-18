// Command: reverse-clip → ppb_reverseClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, TICKS_PER_SECOND, ...) are already defined there.
//
// Reverses (or un-reverses) a clip's playback direction. REWRITTEN
// 2026-07-17 after the probe session (see BUILD_FINDINGS.md corrections):
// the working route on this build is the live-calibrated 5-arg
//   qeClip.setSpeed(speedMultiplier, ticksString, reverse, false, false)
// whose THIRD argument is the reverse flag (verified via
// isSpeedReversed()). Negative speeds do NOT reverse — they clamp to a
// degenerate state — so the current speed magnitude is preserved and
// only the flag flips. setReverse() is still tried first in case a
// future build grows it (it did not exist on 26.3.0).
//
// getSpeed()/setSpeed speeds are MULTIPLIERS on this build (1 = 100%).
// Verified via the standard DOM's clip.isSpeedReversed() read-back —
// never via either QE call's own return value.

function ppb_reverseClip(argsJson) {
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
    var reverse = args.reverse !== false; // default true, matching the reference tool

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
    var clip = resolved.clip;
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var previousReversed = null;
    try { previousReversed = clip.isSpeedReversed() == 1; } catch (e) { previousReversed = null; }
    var previousSpeed = null;
    try { previousSpeed = clip.getSpeed(); } catch (e) { previousSpeed = null; }

    if (previousReversed === reverse) {
      return JSON.stringify({
        ok: true,
        result: {
          sequenceName: seq.name,
          trackType: args.trackType,
          trackIndex: args.trackIndex,
          clipIndex: args.clipIndex,
          clipName: clipName,
          requestedReversed: reverse,
          previousReversed: previousReversed,
          newReversed: previousReversed,
          alreadyInRequestedState: true,
          verified: true
        }
      });
    }

    // setSpeed's ticks argument must be a plausible value — the clip's
    // own current timeline duration (garbage there collapses the clip to
    // one frame, per the calibration notes).
    var durTicks = null;
    try {
      durTicks = String(Math.round((clip.end.seconds - clip.start.seconds) * TICKS_PER_SECOND));
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read the clip's duration for setSpeed's ticks argument: " + e.toString() });
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

    var attempts = [];
    var succeeded = false;
    var formUsed = null;

    // setReverse() did not exist on 26.3.0 — kept as a cheap first probe
    // in case a future build grows it.
    if (typeof qeClip.setReverse === "function") {
      try {
        qeClip.setReverse(reverse);
        attempts.push({ form: "setReverse(bool)", success: true });
        succeeded = true;
        formUsed = "setReverse(bool)";
      } catch (e) {
        attempts.push({ form: "setReverse(bool)", success: false, error: e.toString() });
      }
    }

    if (!succeeded && typeof qeClip.setSpeed === "function") {
      // preserve the current speed magnitude; getSpeed() is a multiplier
      var magnitude = (previousSpeed !== null && previousSpeed !== 0) ? Math.abs(previousSpeed) : 1;
      try {
        qeClip.setSpeed(magnitude, durTicks, reverse, false, false);
        attempts.push({ form: "setSpeed(multiplier, ticksString, reverse, false, false)", success: true });
        succeeded = true;
        formUsed = "setSpeed(multiplier, ticksString, reverse, false, false)";
      } catch (e) {
        attempts.push({ form: "setSpeed(multiplier, ticksString, reverse, false, false)", success: false, error: e.toString() });
      }
    }

    if (!succeeded) {
      return JSON.stringify({
        ok: false,
        error: "could not reverse the clip with setReverse() or the calibrated setSpeed() form",
        attempts: attempts
      });
    }

    var newReversed = null;
    try { newReversed = clip.isSpeedReversed() == 1; } catch (e) { newReversed = null; }
    var newSpeed = null;
    try { newSpeed = clip.getSpeed(); } catch (e) { newSpeed = null; }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName,
      requestedReversed: reverse,
      formUsed: formUsed,
      attempts: attempts,
      previousReversed: previousReversed,
      newReversed: newReversed,
      previousSpeed: previousSpeed,
      newSpeed: newSpeed,
      verified: newReversed === reverse
    };
    if (newReversed === null) {
      result.note = "clip.isSpeedReversed() was not readable on this build — the QE call did not throw, but the result is unverified.";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
