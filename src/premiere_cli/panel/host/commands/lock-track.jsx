// Command: lock-track → ppb_lockTrack
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `lock_track` tool (tracks.ts), generalized here to accept trackType
// video|audio (the reference only locked video tracks) since
// track.setLocked() is not video-specific. Tries setLocked(1|0) then
// setLock(bool) [ayushozha probes both; our build's QE reflect list shows
// "setLock" so the standard-DOM equivalent may or may not share the name —
// try both rather than assume]. Verified by reading isLocked() back.
function ppb_lockTrack(argsJson) {
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
    if (typeof args.locked !== "boolean") {
      return JSON.stringify({ ok: false, error: "locked must be a boolean" });
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
    var numTracks = trackCollection.numTracks;
    if (args.trackIndex >= numTracks) {
      return JSON.stringify({
        ok: false,
        error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " " + args.trackType + " track(s)"
      });
    }

    var track = trackCollection[args.trackIndex];
    var attempts = [];
    var applied = false;

    try {
      track.setLocked(args.locked ? 1 : 0);
      attempts.push({ form: "setLocked", success: true });
      applied = true;
    } catch (e) {
      attempts.push({ form: "setLocked", success: false, error: e.toString() });
    }

    if (!applied) {
      try {
        track.setLock(args.locked);
        attempts.push({ form: "setLock", success: true });
        applied = true;
      } catch (e) {
        attempts.push({ form: "setLock", success: false, error: e.toString() });
      }
    }

    if (!applied) {
      return JSON.stringify({
        ok: false,
        error: "could not lock/unlock the track with any known form (setLocked, setLock)",
        attempts: attempts
      });
    }

    var isLockedNow = null;
    try {
      isLockedNow = track.isLocked();
    } catch (e) {
      isLockedNow = null;
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      trackName: null,
      requestedLocked: args.locked,
      isLocked: isLockedNow,
      attempts: attempts
    };
    try { result.trackName = track.name; } catch (e) { result.trackName = null; }

    if (isLockedNow !== null && isLockedNow !== args.locked) {
      result.warning = "isLocked() read back " + isLockedNow + " after requesting " + args.locked + " — mutation may not have taken effect";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
