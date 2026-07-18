// Command: get-timeline-gaps → ppb_getTimelineGaps
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM read only, no QE DOM needed. Assumes each track's clips
// collection is already ordered by start time (Premiere returns it that
// way) — walks each track once, tracking the end of the previous clip and
// reporting any gap larger than minGapSeconds before the next one.

var PPB_TIMELINE_GAPS_DEFAULT_MIN_SECONDS = 0.04;

function ppbTimelineGaps_findGaps(tracks, trackType, minGapSeconds, gaps) {
  for (var t = 0; t < tracks.numTracks; t++) {
    var track = tracks[t];
    var numClips = 0;
    try {
      numClips = track.clips.numItems;
    } catch (e) {
      numClips = 0;
    }
    if (numClips === 0) {
      continue;
    }

    var trackName = null;
    try { trackName = track.name; } catch (e) { trackName = null; }

    var prevEnd = 0;
    var prevClipName = null;
    for (var c = 0; c < numClips; c++) {
      var clip = track.clips[c];

      var startSeconds = null;
      var endSeconds = null;
      var clipName = null;
      try { startSeconds = timeValueToSeconds(clip.start); } catch (e) { startSeconds = null; }
      try { endSeconds = timeValueToSeconds(clip.end); } catch (e) { endSeconds = null; }
      try { clipName = clip.name; } catch (e) { clipName = null; }

      if (startSeconds !== null) {
        var gapSeconds = startSeconds - prevEnd;
        if (gapSeconds > minGapSeconds) {
          gaps.push({
            trackType: trackType,
            trackIndex: t,
            trackName: trackName,
            gapStartSeconds: prevEnd,
            gapEndSeconds: startSeconds,
            gapDurationSeconds: gapSeconds,
            beforeClip: prevClipName,
            afterClip: clipName
          });
        }
      }

      if (endSeconds !== null) {
        prevEnd = endSeconds;
      }
      prevClipName = clipName;
    }
  }
}

function ppb_getTimelineGaps(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
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

    var trackType = args.trackType;
    if (trackType !== "video" && trackType !== "audio" && trackType !== "both" && typeof trackType !== "undefined" && trackType !== null) {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\", \"audio\", or \"both\"" });
    }
    if (!trackType) {
      trackType = "both";
    }

    var minGapSeconds = PPB_TIMELINE_GAPS_DEFAULT_MIN_SECONDS;
    if (typeof args.minGapSeconds === "number" && args.minGapSeconds >= 0) {
      minGapSeconds = args.minGapSeconds;
    }

    var gaps = [];
    if (trackType !== "audio") {
      ppbTimelineGaps_findGaps(seq.videoTracks, "video", minGapSeconds, gaps);
    }
    if (trackType !== "video") {
      ppbTimelineGaps_findGaps(seq.audioTracks, "audio", minGapSeconds, gaps);
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        gapCount: gaps.length,
        minGapSeconds: minGapSeconds,
        gaps: gaps
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
