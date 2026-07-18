// Command: get-clip-at-position → ppb_getClipAtPosition
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// serializeTrackItem, timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM read only (seq.videoTracks[i].clips[j]) — no QE DOM needed,
// no need to activate the sequence tab. Ported from leancoderkavy's
// premiere-pro-mcp `get_clip_at_position` tool (discovery.ts), which only
// searches one specific track; here `trackType`/`trackIndex` are optional
// filters — omitting both scans every video and audio track for whichever
// clip (if any) covers the given time.

function ppb_getClipAtPosition(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.seconds !== "number" || !isFinite(args.seconds) || args.seconds < 0) {
      return JSON.stringify({ ok: false, error: "seconds must be a non-negative number" });
    }
    if (typeof args.trackType !== "undefined" && args.trackType !== "video" && args.trackType !== "audio") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" or \"audio\" if given" });
    }
    if (typeof args.trackIndex !== "undefined") {
      if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
        return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer if given" });
      }
      if (!args.trackType) {
        return JSON.stringify({ ok: false, error: "trackIndex requires trackType to also be given" });
      }
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

    var clips = [];

    function scanTrack(track, trackType, trackIndex) {
      var numClips = 0;
      try { numClips = track.clips.numItems; } catch (e) { return; }
      for (var c = 0; c < numClips; c++) {
        var clip = track.clips[c];
        var startSeconds = null;
        var endSeconds = null;
        try { startSeconds = timeValueToSeconds(clip.start); } catch (e) { startSeconds = null; }
        try { endSeconds = timeValueToSeconds(clip.end); } catch (e) { endSeconds = null; }
        if (startSeconds === null || endSeconds === null) {
          continue;
        }
        if (args.seconds >= startSeconds && args.seconds < endSeconds) {
          var serialized = serializeTrackItem(clip, trackIndex, c);
          serialized.trackType = trackType;
          clips.push(serialized);
        }
      }
    }

    function scanTrackType(trackType) {
      var trackCollection = trackType === "video" ? seq.videoTracks : seq.audioTracks;
      var numTracks = 0;
      try { numTracks = trackCollection.numTracks; } catch (e) { numTracks = 0; }

      if (typeof args.trackIndex === "number" && args.trackType === trackType) {
        if (args.trackIndex >= numTracks) {
          return "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " " + trackType + " track(s)";
        }
        scanTrack(trackCollection[args.trackIndex], trackType, args.trackIndex);
        return null;
      }

      for (var t = 0; t < numTracks; t++) {
        scanTrack(trackCollection[t], trackType, t);
      }
      return null;
    }

    if (!args.trackType || args.trackType === "video") {
      var videoErr = scanTrackType("video");
      if (videoErr) {
        return JSON.stringify({ ok: false, error: videoErr });
      }
    }
    if (!args.trackType || args.trackType === "audio") {
      var audioErr = scanTrackType("audio");
      if (audioErr) {
        return JSON.stringify({ ok: false, error: audioErr });
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        seconds: args.seconds,
        clipCount: clips.length,
        clips: clips
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
