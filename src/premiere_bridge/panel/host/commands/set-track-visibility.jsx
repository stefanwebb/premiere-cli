// Command: set-track-visibility → ppb_setTrackVisibility
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Video-only. Ported from leancoderkavy's premiere-pro-mcp
// `toggle_track_visibility` tool (tracks.ts) — renamed here from "toggle"
// to an explicit "set" (visible: bool) for idempotence, matching this
// panel's other set-* commands.
//
// IMPORTANT API caveat: there is no standard-DOM API for a video track's
// "eye icon" visibility distinct from its mute flag — the reference
// project's toggle_track_visibility tool itself calls track.setMute() on a
// video track to implement "visibility" (visible=false -> setMute(1)).
// That is what this command does too: it is NOT a separate visibility
// property, it is track.setMute() applied to a video track, with the
// boolean sense inverted (visible = !muted). Read back via isMuted() as
// the verification proof, translated back to "visible" in the result.
function ppb_setTrackVisibility(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.visible !== "boolean") {
      return JSON.stringify({ ok: false, error: "visible must be a boolean" });
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

    var numTracks = seq.videoTracks.numTracks;
    if (args.trackIndex >= numTracks) {
      return JSON.stringify({
        ok: false,
        error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " video track(s)"
      });
    }

    var track = seq.videoTracks[args.trackIndex];

    try {
      track.setMute(args.visible ? 0 : 1);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "track.setMute() failed: " + e.toString() });
    }

    var isMutedNow = null;
    try {
      isMutedNow = track.isMuted();
    } catch (e) {
      isMutedNow = null;
    }
    var isVisibleNow = isMutedNow === null ? null : !isMutedNow;

    var result = {
      sequenceName: seq.name,
      trackType: "video",
      trackIndex: args.trackIndex,
      trackName: null,
      requestedVisible: args.visible,
      visible: isVisibleNow
    };
    try { result.trackName = track.name; } catch (e) { result.trackName = null; }

    if (isVisibleNow !== null && isVisibleNow !== args.visible) {
      result.warning = "read-back visibility (" + isVisibleNow + ") did not match requested (" + args.visible + ") — mutation may not have taken effect";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
