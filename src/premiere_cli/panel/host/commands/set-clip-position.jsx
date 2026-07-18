// Command: set-clip-position → ppb_setClipPosition
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, setComponentProperty, ...) are already defined there.
//
// Standard-DOM only — no QE needed. Ported from leancoderkavy's
// premiere-pro-mcp `set_clip_position` tool (track-targeting.ts), which
// addresses the clip by node_id via that repo's __findClip() helper; this
// bridge instead uses the same trackType/trackIndex/clipIndex addressing as
// get-full-clip-info (no node-id lookup helper exists here). Sets the
// Motion component's Position property ([x, y] in pixels). Mutating —
// undo is non-functional on this build, so previousValue in the result is
// the caller's only restoration path.

function ppb_setClipPosition(argsJson) {
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
    if (typeof args.x !== "number" || typeof args.y !== "number") {
      return JSON.stringify({ ok: false, error: "x and y must both be numbers (pixels)" });
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
    var numClips = track.clips.numItems;
    if (args.clipIndex >= numClips) {
      return JSON.stringify({
        ok: false,
        error: "clipIndex " + args.clipIndex + " is out of range — track " + args.trackIndex + " has " + numClips + " clip(s)"
      });
    }

    var clip = track.clips[args.clipIndex];
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var motion = findClipComponent(clip, ["AE.ADBE Motion"], ["Motion"]);
    if (!motion) {
      return JSON.stringify({ ok: false, error: "Motion component not found on clip" });
    }

    var setResult = setComponentProperty(motion, ["Position"], [args.x, args.y]);
    if (!setResult.found) {
      return JSON.stringify({ ok: false, error: "Position property not found on the Motion component" });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: clipName,
        previousValue: setResult.previousValue,
        requestedValue: setResult.requestedValue,
        newValue: setResult.newValue,
        verified: setResult.verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
