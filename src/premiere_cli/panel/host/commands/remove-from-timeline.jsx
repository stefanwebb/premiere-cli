// Command: remove-from-timeline → ppb_removeFromTimeline
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeTrackItem, ...) are already defined
// there.
//
// DESTRUCTIVE: permanently removes a clip from the timeline via
// clip.remove(ripple, alignToVideo=false) (PREMIERE_API_NOTES.md's
// "Clips / TrackItems" section — ripple=true closes the gap, false lifts
// it in place). Undo is NON-FUNCTIONAL on this build — there is no path
// back once this succeeds. Ported from leancoderkavy's
// premiere-pro-mcp remove_from_timeline tool, re-addressed to this
// panel's trackType/trackIndex/clipIndex convention instead of node_id.
//
// MUTATION RULE: verified by a track.clips.numItems drop of exactly one,
// never by remove()'s own (undocumented) return value.

function ppb_removeFromTimeline(argsJson) {
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
    if (typeof args.ripple !== "boolean") {
      return JSON.stringify({ ok: false, error: "ripple (boolean) is required" });
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
    var track = args.trackType === "video" ? seq.videoTracks[args.trackIndex] : seq.audioTracks[args.trackIndex];

    var before = serializeTrackItem(clip, args.trackIndex, args.clipIndex);
    var clipCountBefore = null;
    try { clipCountBefore = track.clips.numItems; } catch (e2) { clipCountBefore = null; }

    try {
      clip.remove(args.ripple, false);
    } catch (e3) {
      return JSON.stringify({ ok: false, error: "clip.remove() failed: " + e3.toString() });
    }

    var clipCountAfter = null;
    try { clipCountAfter = track.clips.numItems; } catch (e4) { clipCountAfter = null; }

    var verified = clipCountBefore !== null && clipCountAfter !== null && clipCountAfter === clipCountBefore - 1;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        ripple: args.ripple,
        removedClip: before,
        clipCountBefore: clipCountBefore,
        clipCountAfter: clipCountAfter,
        verified: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
