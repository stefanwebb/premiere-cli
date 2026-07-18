// Command: set-clip-speed → ppb_setClipSpeed
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, resolveQeClip, ensureQEEnabled,
// activateSequenceForQE, TICKS_PER_SECOND, ...) are already defined
// there.
//
// Sets a clip's playback speed via QE. LIVE-CALIBRATED 2026-07-17 (see
// BUILD_FINDINGS.md corrections): the working signature on this build is
// the 5-arg
//   qeClip.setSpeed(speedMultiplier, ticksString, reverse, false, false)
// where:
//   - arg1 is a MULTIPLIER (1 = 100%), NOT a percent — and the
//     standard-DOM clip.getSpeed() read-back uses the same scale (a
//     normal clip reads 1, not 100);
//   - arg2 must be a plausible ticks string — garbage there (e.g. the
//     literal "ticks") collapses the clip to ONE FRAME. The clip's own
//     current duration in ticks is passed;
//   - arg3 is the reverse flag (verified via isSpeedReversed()) —
//     negative multipliers do NOT reverse, they clamp to a degenerate
//     state, so reversal must go through this flag;
//   - args 4/5 are unidentified; false/false is the tested-safe value.
// Speed-up shortens the timeline item to source/speed ROUNDED UP to
// whole frames (getSpeed() then reads the post-rounding actual — e.g.
// requesting 50x on a 27.16s clip yields 48.5). Slow-down does NOT
// extend the item; source usage truncates instead.
//
// MUTATION RULE: verified via the STANDARD-DOM clip.getSpeed()/
// isSpeedReversed() read-back after the QE call — never trusting
// setSpeed()'s own return value. Because of frame rounding the speed
// comparison uses a 5% relative tolerance.

function ppb_setClipSpeed(argsJson) {
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
    if (typeof args.trackIndex !== "number" || typeof args.clipIndex !== "number") {
      return JSON.stringify({ ok: false, error: "trackIndex and clipIndex are required" });
    }
    if (typeof args.speedPercent !== "number" || args.speedPercent === 0) {
      return JSON.stringify({ ok: false, error: "speedPercent is required and must be non-zero (100 = normal, negative = reversed)" });
    }

    var reverse = args.speedPercent < 0;
    var multiplier = Math.abs(args.speedPercent) / 100;

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

    var stdResolved = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    if (stdResolved.error) {
      return JSON.stringify({ ok: false, error: stdResolved.error });
    }
    var stdClip = stdResolved.clip;

    var previousSpeed = null;
    var previousReversed = null;
    try { previousSpeed = stdClip.getSpeed(); } catch (e2) { previousSpeed = null; }
    try { previousReversed = stdClip.isSpeedReversed() === true || stdClip.isSpeedReversed() === 1; } catch (e3) { previousReversed = null; }

    // arg2 of setSpeed must be a plausible ticks string — the clip's own
    // current timeline duration.
    var durTicks = null;
    try {
      durTicks = String(Math.round((stdClip.end.seconds - stdClip.start.seconds) * TICKS_PER_SECOND));
    } catch (e4) {
      return JSON.stringify({ ok: false, error: "could not read the clip's duration for setSpeed's ticks argument: " + e4.toString() });
    }

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e5) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e5.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var qeSeq;
    try {
      qeSeq = qe.project.getActiveSequence();
    } catch (e6) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() failed: " + e6.toString() });
    }

    var qeResolved = resolveQeClip(qeSeq, args.trackType, args.trackIndex, args.clipIndex);
    if (qeResolved.error) {
      return JSON.stringify({ ok: false, error: qeResolved.error });
    }
    var qeClip = qeResolved.qeClip;

    try {
      qeClip.setSpeed(multiplier, durTicks, reverse, false, false);
    } catch (e7) {
      return JSON.stringify({
        ok: false,
        error: "qeClip.setSpeed(multiplier, ticksString, reverse, false, false) threw: " + e7.toString(),
        previousSpeed: previousSpeed,
        previousReversed: previousReversed
      });
    }

    var newSpeed = null;
    var newReversed = null;
    try { newSpeed = stdClip.getSpeed(); } catch (e8) { newSpeed = null; }
    try { newReversed = stdClip.isSpeedReversed() === true || stdClip.isSpeedReversed() === 1; } catch (e9) { newReversed = null; }

    // Frame rounding shifts the actual applied speed (see header) — 5%
    // relative tolerance on the multiplier, exact match on the flag.
    var speedVerified = newSpeed !== null && multiplier > 0 &&
      Math.abs(newSpeed - multiplier) / multiplier <= 0.05;
    var reverseVerified = newReversed !== null ? (newReversed === reverse) : null;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: (function () { try { return stdClip.name; } catch (e) { return null; } })(),
        requestedSpeedPercent: args.speedPercent,
        requestedMultiplier: multiplier,
        reverse: reverse,
        previousSpeed: previousSpeed,
        previousReversed: previousReversed,
        newSpeed: newSpeed,
        newSpeedPercent: newSpeed !== null ? newSpeed * 100 : null,
        newReversed: newReversed,
        verified: speedVerified && reverseVerified !== false,
        note: "getSpeed() values are MULTIPLIERS on this build (1 = 100%); the applied speed is frame-rounded, so newSpeed can differ slightly from the request. Slow-motion does not extend the timeline item."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
