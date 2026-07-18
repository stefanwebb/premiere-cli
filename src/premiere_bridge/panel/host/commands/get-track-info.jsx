// Command: get-track-info → ppb_getTrackInfo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM read only — no QE DOM needed, no need to activate the
// sequence tab. Ported from leancoderkavy's premiere-pro-mcp
// `get_track_info` tool (track-targeting.ts).

function ppb_getTrackInfo(argsJson) {
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

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      name: null,
      clipCount: 0,
      isMuted: null,
      isLocked: null,
      isTargeted: null,
      clips: [],
      transitions: []
    };

    try { result.name = track.name; } catch (e) { result.name = null; }
    try { result.isMuted = track.isMuted(); } catch (e) { result.isMuted = null; }
    try { result.isLocked = track.isLocked(); } catch (e) { result.isLocked = null; }
    try { result.isTargeted = track.isTargeted(); } catch (e) { result.isTargeted = null; }

    try {
      var numClips = track.clips.numItems;
      result.clipCount = numClips;
      for (var c = 0; c < numClips; c++) {
        var clip = track.clips[c];
        var ci = {
          clipIndex: c,
          nodeId: null,
          name: null,
          startSeconds: null,
          endSeconds: null,
          durationSeconds: null,
          disabled: null,
          speed: null
        };
        try { ci.nodeId = clip.nodeId; } catch (e) { ci.nodeId = null; }
        try { ci.name = clip.name; } catch (e) { ci.name = null; }
        try { ci.startSeconds = timeValueToSeconds(clip.start); } catch (e) { ci.startSeconds = null; }
        try { ci.endSeconds = timeValueToSeconds(clip.end); } catch (e) { ci.endSeconds = null; }
        try { ci.durationSeconds = timeValueToSeconds(clip.duration); } catch (e) { ci.durationSeconds = null; }
        try { ci.disabled = clip.disabled; } catch (e) { ci.disabled = null; }
        try { ci.speed = clip.getSpeed(); } catch (e) { ci.speed = null; }
        result.clips.push(ci);
      }
    } catch (e) {
      // leave clips as whatever was collected so far
    }

    try {
      var numTransitions = track.transitions.numItems;
      for (var t = 0; t < numTransitions; t++) {
        var transition = track.transitions[t];
        var ti = { transitionIndex: t, startSeconds: null, endSeconds: null };
        try { ti.startSeconds = timeValueToSeconds(transition.start); } catch (e) { ti.startSeconds = null; }
        try { ti.endSeconds = timeValueToSeconds(transition.end); } catch (e) { ti.endSeconds = null; }
        result.transitions.push(ti);
      }
    } catch (e) {
      // transitions collection unavailable on this track/build — leave empty
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
