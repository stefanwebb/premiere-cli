// Command: get-timeline-summary → ppb_getTimelineSummary
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, serializeTrackItem, ...) are already defined there.
//
// Standard-DOM read only (seq.videoTracks[i].clips[j]) — no QE DOM needed,
// no need to activate the sequence tab. Compact, human-oriented overview —
// no per-clip data, just per-track roll-ups.

// video clips have Motion+Opacity built in (2 baseline components);
// audio clips have their own built-in component(s) (Volume etc, baseline 1).
var GET_TIMELINE_SUMMARY_VIDEO_BASELINE_COMPONENTS = 2;
var GET_TIMELINE_SUMMARY_AUDIO_BASELINE_COMPONENTS = 1;

function ppb_summarizeTrackForTimelineSummary(track, trackIndex, durationSeconds, baselineComponents) {
  var out = { index: trackIndex, name: null, clipCount: 0, coveragePercent: 0 };
  var totalClips = 0;
  var clipsWithEffects = 0;
  var coveredSeconds = 0;

  try { out.name = track.name; } catch (e) { out.name = null; }

  try {
    var numClips = track.clips.numItems;
    out.clipCount = numClips;
    totalClips = numClips;

    for (var c = 0; c < numClips; c++) {
      var clip = track.clips[c];

      try {
        var clipDuration = timeValueToSeconds(clip.duration);
        if (clipDuration !== null) {
          coveredSeconds += clipDuration;
        }
      } catch (e) {
        // skip unreadable clip duration
      }

      try {
        if (clip.components.numItems > baselineComponents) {
          clipsWithEffects++;
        }
      } catch (e) {
        // skip unreadable clip components
      }
    }
  } catch (e) {
    // leave clipCount/totals as whatever was collected so far
  }

  if (durationSeconds && durationSeconds > 0) {
    out.coveragePercent = Math.round((coveredSeconds / durationSeconds) * 1000) / 10;
  } else {
    out.coveragePercent = 0;
  }

  return { track: out, totalClips: totalClips, clipsWithEffects: clipsWithEffects };
}

function ppb_getTimelineSummary(argsJson) {
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

    var frameRate = null;
    try {
      frameRate = getSequenceFps(seq);
    } catch (e) {
      frameRate = null;
    }

    var durationSeconds = null;
    try {
      durationSeconds = (Number(seq.end) - Number(seq.zeroPoint)) / TICKS_PER_SECOND;
    } catch (e) {
      durationSeconds = null;
    }

    var totalClips = 0;
    var clipsWithEffects = 0;

    var videoTracks = [];
    try {
      for (var v = 0; v < seq.videoTracks.numTracks; v++) {
        var vSummary = ppb_summarizeTrackForTimelineSummary(
          seq.videoTracks[v], v, durationSeconds, GET_TIMELINE_SUMMARY_VIDEO_BASELINE_COMPONENTS
        );
        videoTracks.push(vSummary.track);
        totalClips += vSummary.totalClips;
        clipsWithEffects += vSummary.clipsWithEffects;
      }
    } catch (e) {
      // leave videoTracks as whatever was collected so far
    }

    var audioTracks = [];
    try {
      for (var a = 0; a < seq.audioTracks.numTracks; a++) {
        var aSummary = ppb_summarizeTrackForTimelineSummary(
          seq.audioTracks[a], a, durationSeconds, GET_TIMELINE_SUMMARY_AUDIO_BASELINE_COMPONENTS
        );
        audioTracks.push(aSummary.track);
        totalClips += aSummary.totalClips;
        clipsWithEffects += aSummary.clipsWithEffects;
      }
    } catch (e) {
      // leave audioTracks as whatever was collected so far
    }

    var markerCount = null;
    try {
      markerCount = seq.markers.numMarkers;
    } catch (e) {
      markerCount = null;
    }

    var result = {
      sequenceName: seq.name,
      frameRate: frameRate,
      durationSeconds: durationSeconds,
      videoTracks: videoTracks,
      audioTracks: audioTracks,
      totalClips: totalClips,
      clipsWithEffects: clipsWithEffects,
      markerCount: markerCount
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
