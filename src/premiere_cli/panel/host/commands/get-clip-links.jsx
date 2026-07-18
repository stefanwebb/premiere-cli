// Command: get-clip-links → ppb_getClipLinks
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM read only, no QE DOM needed. Clip addressing (sequenceName?,
// trackType, trackIndex, clipIndex) matches get-full-clip-info.jsx. Linked
// clips are detected heuristically — same source projectItem.nodeId and
// the same start time — since there is no direct "get linked items" API
// (per PREMIERE_API_NOTES.md's Clips/TrackItems section). Helper names are
// prefixed ppbClipLinks_ to avoid colliding with same-purpose helpers in
// other lazily-loaded command files evaluated into this same global
// context.

function ppbClipLinks_findLinked(tracks, trackTypeLabel, clipNodeId, clipStartSeconds, srcNodeId, linked) {
  for (var t = 0; t < tracks.numTracks; t++) {
    var track = tracks[t];
    var numClips = 0;
    try {
      numClips = track.clips.numItems;
    } catch (e) {
      numClips = 0;
    }

    for (var c = 0; c < numClips; c++) {
      var other = track.clips[c];

      var otherNodeId = null;
      try { otherNodeId = other.nodeId; } catch (e) { otherNodeId = null; }
      if (otherNodeId && clipNodeId && otherNodeId === clipNodeId) {
        continue;
      }

      var otherSrcNodeId = null;
      try {
        otherSrcNodeId = other.projectItem ? other.projectItem.nodeId : null;
      } catch (e) {
        otherSrcNodeId = null;
      }

      var otherStartSeconds = null;
      try { otherStartSeconds = timeValueToSeconds(other.start); } catch (e) { otherStartSeconds = null; }

      if (srcNodeId && otherSrcNodeId === srcNodeId && otherStartSeconds !== null && clipStartSeconds !== null && otherStartSeconds === clipStartSeconds) {
        var entry = { nodeId: otherNodeId, name: null, trackType: trackTypeLabel, trackIndex: t, startSeconds: otherStartSeconds, endSeconds: null };
        try { entry.name = other.name; } catch (e) { entry.name = null; }
        try { entry.endSeconds = timeValueToSeconds(other.end); } catch (e) { entry.endSeconds = null; }
        linked.push(entry);
      }
    }
  }
}

function ppb_getClipLinks(argsJson) {
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

    var info = { nodeId: null, name: null, trackType: args.trackType, trackIndex: args.trackIndex, clipIndex: args.clipIndex };
    try { info.nodeId = clip.nodeId; } catch (e) { info.nodeId = null; }
    try { info.name = clip.name; } catch (e) { info.name = null; }

    var clipStartSeconds = null;
    try { clipStartSeconds = timeValueToSeconds(clip.start); } catch (e) { clipStartSeconds = null; }

    var srcNodeId = null;
    try {
      srcNodeId = clip.projectItem ? clip.projectItem.nodeId : null;
    } catch (e) {
      srcNodeId = null;
    }

    var linked = [];
    ppbClipLinks_findLinked(seq.videoTracks, "video", info.nodeId, clipStartSeconds, srcNodeId, linked);
    ppbClipLinks_findLinked(seq.audioTracks, "audio", info.nodeId, clipStartSeconds, srcNodeId, linked);

    info.linkedClips = linked;
    info.linkedCount = linked.length;

    return JSON.stringify({ ok: true, result: info });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
