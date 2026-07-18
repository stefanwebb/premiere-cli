// Command: duplicate-clip → ppb_duplicateClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeTrackItem, secondsToTicksString,
// timeValueToSeconds, ...) are already defined there.
//
// Inserts a NEW instance of the addressed clip's own projectItem onto
// the SAME track, via the standard-DOM seq.insertClip() (ripple) —
// PREMIERE_API_NOTES.md's "Clips / TrackItems" insert form, same as
// add-to-timeline. Ported from leancoderkavy's premiere-pro-mcp
// duplicate_clip tool, adapted: the reference places the duplicate on
// trackIndex+1 (a DIFFERENT track) with no position argument; this
// command instead keeps it on the SAME track (no second track is implied
// by this panel's clip-addressing convention) and accepts an explicit
// targetStartSeconds, defaulting to right after the original clip's own
// end (clip.endSeconds) so it never collides with the original — insert
// ripples, so there's no destructive overwrite risk either way.
//
// MUTATION RULE: verified via the track's clips.numItems increasing by
// exactly one, plus a best-effort lookup of the newly-inserted clip by
// matching projectItem + requested start time (serialized the same way
// as get-full-clip-info).

function ppb_duplicateClip(argsJson) {
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

    var projectItem = null;
    try { projectItem = clip.projectItem; } catch (e2) { projectItem = null; }
    if (!projectItem) {
      return JSON.stringify({ ok: false, error: "could not read the source projectItem for this clip" });
    }
    var itemNodeId = null;
    try { itemNodeId = projectItem.nodeId; } catch (e3) { itemNodeId = null; }

    var originalBefore = serializeTrackItem(clip, args.trackIndex, args.clipIndex);

    var targetStartSeconds;
    if (typeof args.targetStartSeconds === "number") {
      targetStartSeconds = args.targetStartSeconds;
    } else if (originalBefore.endSeconds !== null) {
      targetStartSeconds = originalBefore.endSeconds;
    } else {
      return JSON.stringify({ ok: false, error: "targetStartSeconds was not given and the original clip's endSeconds could not be read to default it" });
    }

    var trackCollection = args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var track = trackCollection[args.trackIndex];
    var clipCountBefore = null;
    try { clipCountBefore = track.clips.numItems; } catch (e4) { clipCountBefore = null; }

    var vIdx = args.trackType === "video" ? args.trackIndex : -1;
    var aIdx = args.trackType === "audio" ? args.trackIndex : -1;
    var startTicks = secondsToTicksString(targetStartSeconds);

    try {
      seq.insertClip(projectItem, startTicks, vIdx, aIdx);
    } catch (e5) {
      return JSON.stringify({ ok: false, error: "seq.insertClip() failed: " + e5.toString() });
    }

    var clipCountAfter = null;
    try { clipCountAfter = track.clips.numItems; } catch (e6) { clipCountAfter = null; }
    var verified = clipCountBefore !== null && clipCountAfter !== null && clipCountAfter === clipCountBefore + 1;

    var newClip = null;
    var toleranceSeconds = 0.1;
    try {
      for (var c = 0; c < track.clips.numItems; c++) {
        var candidate = track.clips[c];
        var candNodeId = null;
        try { candNodeId = candidate.projectItem.nodeId; } catch (e7) { candNodeId = null; }
        if (candNodeId !== itemNodeId) {
          continue;
        }
        var candStart = null;
        try { candStart = timeValueToSeconds(candidate.start); } catch (e8) { candStart = null; }
        if (candStart !== null && Math.abs(candStart - targetStartSeconds) <= toleranceSeconds) {
          newClip = serializeTrackItem(candidate, args.trackIndex, c);
          break;
        }
      }
    } catch (e9) {
      newClip = null;
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        sourceClipIndex: args.clipIndex,
        targetStartSeconds: targetStartSeconds,
        originalClip: originalBefore,
        newClip: newClip,
        clipCountBefore: clipCountBefore,
        clipCountAfter: clipCountAfter,
        verified: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
