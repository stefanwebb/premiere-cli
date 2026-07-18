// Command: move-clip → ppb_moveClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeTrackItem, tryTimeForms, ...) are already
// defined there.
//
// Moves a clip to a new ABSOLUTE start time on the SAME track via
// clip.start assignment (PREMIERE_API_NOTES.md: "assign clip.start =
// newStartTicksString ... neither standard-DOM path changes track" —
// this command does not attempt a cross-track move, matching that
// documented limitation). Key-argument form is disputed across builds
// (ticks string vs Time object vs raw seconds), so tryTimeForms() tries
// each in turn.
//
// MUTATION RULE: verified via a clip.start read-back after the
// assignment, compared against the requested startSeconds with a
// tolerance (frame-quantization is expected).

function ppb_moveClip(argsJson) {
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
    if (typeof args.startSeconds !== "number") {
      return JSON.stringify({ ok: false, error: "startSeconds is required" });
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
    var clip = resolved.clip;

    var before = serializeTrackItem(clip, args.trackIndex, args.clipIndex);

    var attemptResult = tryTimeForms(args.startSeconds, function (timeArg) {
      clip.start = timeArg;
    });

    if (!attemptResult.success) {
      return JSON.stringify({
        ok: false,
        error: "could not set clip.start with any known argument form (ticksString, Time object, seconds) — see attempts",
        attempts: attemptResult.attempts,
        previousValue: before
      });
    }

    var after = serializeTrackItem(clip, args.trackIndex, args.clipIndex);
    var verified = after.startSeconds !== null && Math.abs(after.startSeconds - args.startSeconds) <= 0.05;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        requestedStartSeconds: args.startSeconds,
        previousValue: before,
        newValue: after,
        verified: verified,
        formUsed: attemptResult.formUsed,
        attempts: attemptResult.attempts
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
