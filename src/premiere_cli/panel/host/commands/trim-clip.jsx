// Command: trim-clip → ppb_trimClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeTrackItem, tryTimeForms, ...) are already
// defined there.
//
// Trims a clip's in and/or out point — SOURCE-MEDIA-RELATIVE seconds, per
// leancoderkavy's premiere-pro-mcp trim_clip tool and
// PREMIERE_API_NOTES.md ("assign clip.inPoint/outPoint (Time or ticks
// string)"). At least one of inPointSeconds/outPointSeconds is required.
//
// MUTATION RULE: each requested field is verified via its own read-back
// after assignment, compared against the request with a tolerance
// (frame-quantization is expected). A failure on one field does not
// block attempting the other.

function ppb_trimClip(argsJson) {
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
    var hasIn = typeof args.inPointSeconds === "number";
    var hasOut = typeof args.outPointSeconds === "number";
    if (!hasIn && !hasOut) {
      return JSON.stringify({ ok: false, error: "at least one of inPointSeconds/outPointSeconds is required" });
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
    var changes = {};

    if (hasIn) {
      var inAttempt = tryTimeForms(args.inPointSeconds, function (timeArg) {
        clip.inPoint = timeArg;
      });
      var inNewValue = null;
      try { inNewValue = timeValueToSeconds(clip.inPoint); } catch (e2) { inNewValue = null; }
      changes.inPoint = {
        requestedValue: args.inPointSeconds,
        previousValue: before.inPointSeconds,
        newValue: inNewValue,
        verified: inAttempt.success && inNewValue !== null && Math.abs(inNewValue - args.inPointSeconds) <= 0.05,
        attempts: inAttempt.attempts
      };
    }

    if (hasOut) {
      var outAttempt = tryTimeForms(args.outPointSeconds, function (timeArg) {
        clip.outPoint = timeArg;
      });
      var outNewValue = null;
      try { outNewValue = timeValueToSeconds(clip.outPoint); } catch (e3) { outNewValue = null; }
      changes.outPoint = {
        requestedValue: args.outPointSeconds,
        previousValue: before.outPointSeconds,
        newValue: outNewValue,
        verified: outAttempt.success && outNewValue !== null && Math.abs(outNewValue - args.outPointSeconds) <= 0.05,
        attempts: outAttempt.attempts
      };
    }

    var after = serializeTrackItem(clip, args.trackIndex, args.clipIndex);

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        previousValue: before,
        newValue: after,
        changes: changes
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
