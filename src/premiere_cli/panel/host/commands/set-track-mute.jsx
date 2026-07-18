// Command: set-track-mute → ppb_setTrackMute
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp `mute_track` tool
// (audio.ts) — renamed here from a bare "mute" toggle to an explicit
// "set" (muted: bool) for idempotence. Generalized to accept trackType
// video|audio (the reference only muted audio tracks); track.setMute() is
// not audio-specific — see also set-track-visibility, which uses the same
// call on video tracks for a different semantic purpose. Verified by
// reading isMuted() back.
function ppb_setTrackMute(argsJson) {
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
    if (typeof args.muted !== "boolean") {
      return JSON.stringify({ ok: false, error: "muted must be a boolean" });
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
      track.setMute(args.muted ? 1 : 0);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "track.setMute() failed: " + e.toString() });
    }

    var isMutedNow = null;
    try {
      isMutedNow = track.isMuted();
    } catch (e) {
      isMutedNow = null;
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      trackName: null,
      requestedMuted: args.muted,
      isMuted: isMutedNow
    };
    try { result.trackName = track.name; } catch (e) { result.trackName = null; }

    if (isMutedNow !== null && isMutedNow !== args.muted) {
      result.warning = "isMuted() read back " + isMutedNow + " after requesting " + args.muted + " — mutation may not have taken effect";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
