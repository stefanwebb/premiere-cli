// Command: set-target-track → ppb_setTargetTrack
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `set_target_track` tool (track-targeting.ts): track.setTargeted(targeted,
// isVideoBool) — only one video and one audio track can be targeted at a
// time, per Premiere's own UI behavior (targeting one track un-targets any
// other track of the same type; this command does not do that itself, it
// relies on Premiere's own setTargeted() semantics). Verified by reading
// isTargeted() back.
function ppb_setTargetTrack(argsJson) {
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
    if (typeof args.targeted !== "boolean") {
      return JSON.stringify({ ok: false, error: "targeted must be a boolean" });
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

    try {
      track.setTargeted(args.targeted, args.trackType === "video");
    } catch (e) {
      return JSON.stringify({ ok: false, error: "track.setTargeted() failed: " + e.toString() });
    }

    var isTargetedNow = null;
    try {
      isTargetedNow = track.isTargeted();
    } catch (e) {
      isTargetedNow = null;
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      trackName: null,
      requestedTargeted: args.targeted,
      isTargeted: isTargetedNow
    };
    try { result.trackName = track.name; } catch (e) { result.trackName = null; }

    if (isTargetedNow !== null && isTargetedNow !== args.targeted) {
      result.warning = "isTargeted() read back " + isTargetedNow + " after requesting " + args.targeted + " — mutation may not have taken effect";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
