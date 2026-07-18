// Command: get-clip-at-playhead → ppb_getClipAtPlayhead
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// serializeTrackItem, timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM read only — no QE DOM needed, no need to activate the
// sequence tab. Ported from leancoderkavy's premiere-pro-mcp
// `get_clip_at_playhead` tool (utility.ts): finds every clip (across all
// tracks, or just video/audio) that covers the sequence's current
// playhead position.

function ppb_getClipAtPlayhead(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var trackType = args.trackType || "both";
    if (trackType !== "video" && trackType !== "audio" && trackType !== "both") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\", \"audio\", or \"both\"" });
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

    var playheadSeconds = null;
    try {
      playheadSeconds = timeValueToSeconds(seq.getPlayerPosition());
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read playhead position: " + e.toString() });
    }
    if (playheadSeconds === null) {
      return JSON.stringify({ ok: false, error: "could not read playhead position" });
    }

    var clips = [];

    function findAtPlayhead(trackCollection, type) {
      var numTracks = 0;
      try { numTracks = trackCollection.numTracks; } catch (e) { return; }
      for (var t = 0; t < numTracks; t++) {
        var track = trackCollection[t];
        var numClips = 0;
        try { numClips = track.clips.numItems; } catch (e) { continue; }
        for (var c = 0; c < numClips; c++) {
          var clip = track.clips[c];
          var startSeconds = null;
          var endSeconds = null;
          try { startSeconds = timeValueToSeconds(clip.start); } catch (e) { startSeconds = null; }
          try { endSeconds = timeValueToSeconds(clip.end); } catch (e) { endSeconds = null; }
          if (startSeconds === null || endSeconds === null) {
            continue;
          }
          if (startSeconds <= playheadSeconds && endSeconds > playheadSeconds) {
            var serialized = serializeTrackItem(clip, t, c);
            serialized.trackType = type;
            clips.push(serialized);
          }
        }
      }
    }

    if (trackType !== "audio") {
      findAtPlayhead(seq.videoTracks, "video");
    }
    if (trackType !== "video") {
      findAtPlayhead(seq.audioTracks, "audio");
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        playheadSeconds: playheadSeconds,
        clipCount: clips.length,
        clips: clips
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
