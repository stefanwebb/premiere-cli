// Command: remove-track-intervals → ppb_removeTrackIntervals
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, getSequenceFps, timecodeToSeconds, ...) are already
// defined there.
//
// Ripple-deletes a list of time intervals from an audio track (and,
// optionally, from one or more linked video tracks so they stay in
// sync), via the QE DOM's razor() + a rippleDelete()/remove() fallback
// whose success is judged by an actual numItems drop, not either call's
// return value (both are unreliable in practice on this Premiere
// version). Adapted from a proven implementation in a sibling project.
//
// QE DOM operates on qe.project.getActiveSequence() only — whichever
// sequence tab is frontmost — so this command makes the resolved
// sequence the active one first (app.project.activeSequence = seq)
// rather than erroring if it isn't already.

function toQeTimecode(timecode) {
  // remove_pauses.py's frames_to_timecode() emits total elapsed minutes with
  // no 60-minute cap (e.g. 75 minutes in prints as "75:03:12"), so MM here
  // can exceed 59 for any sequence over an hour. QE razor() wants a genuine
  // "HH:MM:SS:FF" with minutes in [0,59], so carry the excess into hours
  // rather than assuming MM is always sub-hour.
  var parts = timecode.split(":");
  var totalMinutes = parseInt(parts[0], 10);
  var seconds = parts[1];
  var frames = parts[2];
  var hours = Math.floor(totalMinutes / 60);
  var minutes = totalMinutes % 60;
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  return pad2(hours) + ":" + pad2(minutes) + ":" + seconds + ":" + frames;
}

function findAndRemoveInRange(qeTrack, startSeconds, endSeconds, tolerance, warnings, trackLabel) {
  var matches = [];
  for (var k = 0; k < qeTrack.numItems; k++) {
    var item = qeTrack.getItemAt(k);
    // QE track items include "Empty" gap placeholders alongside real
    // "Clip" items (confirmed earlier this session, see QE_DOM_NOTES.md).
    // Razoring both boundaries of a pause can leave an Empty item bounded
    // by the same tolerance window as the real Clip we actually want to
    // remove — attempting to remove an Empty item is a harmless no-op
    // (there's nothing there), but it was previously misreported as a
    // removal failure. Skip non-Clip items so warnings only fire for
    // genuine failures.
    if (item.type !== "Clip") {
      continue;
    }
    var itemStart = Number(item.start.ticks) / TICKS_PER_SECOND;
    var itemEnd = Number(item.end.ticks) / TICKS_PER_SECOND;
    if (itemStart > startSeconds - tolerance && itemEnd < endSeconds + tolerance) {
      matches.push(item);
    }
  }

  var removed = 0;
  for (var m = 0; m < matches.length; m++) {
    var target = matches[m];
    var succeeded = false;
    var itemCountBefore = qeTrack.numItems;

    if (typeof target.rippleDelete === "function") {
      try {
        target.rippleDelete();
      } catch (e) {
        // fall through to the numItems check below regardless
      }
      succeeded = qeTrack.numItems < itemCountBefore;
    }

    if (!succeeded && typeof target.remove === "function") {
      // QE clip.remove()'s two boolean params are undocumented (roughly
      // ripple/alignToVideo-shaped, per Premiere's standard-DOM equivalent) —
      // try plausible combinations and judge success by numItems, not by
      // assuming what either flag means.
      var attempts = [[true, false], [true, true], [false, true], [false, false]];
      for (var a = 0; a < attempts.length && !succeeded; a++) {
        var countBeforeAttempt = qeTrack.numItems;
        try {
          target.remove(attempts[a][0], attempts[a][1]);
        } catch (e) {
          // fall through to the numItems check below regardless
        }
        succeeded = qeTrack.numItems < countBeforeAttempt;
      }
    }

    if (succeeded) {
      removed++;
    }
  }

  if (removed < matches.length) {
    warnings.push(
      trackLabel + ": " + (matches.length - removed) + " of " + matches.length +
      " segment(s) in range could not be removed (rippleDelete/remove all reported no change)"
    );
  }

  return removed;
}

function ppb_removeTrackIntervals(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.audioTrackIndex !== "number" || args.audioTrackIndex < 0 || Math.floor(args.audioTrackIndex) !== args.audioTrackIndex) {
      return JSON.stringify({ ok: false, error: "audioTrackIndex must be a non-negative integer" });
    }
    var videoTrackIndices = args.videoTrackIndices || [];
    if (!(videoTrackIndices instanceof Array)) {
      return JSON.stringify({ ok: false, error: "videoTrackIndices must be an array" });
    }
    for (var vi = 0; vi < videoTrackIndices.length; vi++) {
      var vIdx = videoTrackIndices[vi];
      if (typeof vIdx !== "number" || vIdx < 0 || Math.floor(vIdx) !== vIdx) {
        return JSON.stringify({ ok: false, error: "videoTrackIndices must all be non-negative integers" });
      }
    }
    if (!(args.intervals instanceof Array) || args.intervals.length === 0) {
      return JSON.stringify({ ok: false, error: "intervals must be a non-empty array" });
    }
    var timecodeRe = /^\d{2,3}:\d{2}:\d{2}$/;
    for (var ii = 0; ii < args.intervals.length; ii++) {
      var iv = args.intervals[ii];
      if (!iv || typeof iv.start !== "string" || typeof iv.end !== "string" ||
          !timecodeRe.test(iv.start) || !timecodeRe.test(iv.end)) {
        return JSON.stringify({ ok: false, error: "each interval must have \"start\"/\"end\" as \"MM:SS:FF\" strings (index " + ii + ")" });
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

    // QE DOM only ever operates on the active sequence tab — switch to it
    // rather than erroring if the resolved sequence isn't already active.
    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
    }

    try {
      ensureQEEnabled();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }
    var qeSequence = qe.project.getActiveSequence();
    if (!qeSequence) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() returned nothing after activating the sequence" });
    }

    if (args.audioTrackIndex >= qeSequence.numAudioTracks) {
      return JSON.stringify({
        ok: false,
        error: "audioTrackIndex " + args.audioTrackIndex + " is out of range (sequence \"" + seq.name + "\" has " + qeSequence.numAudioTracks + " audio track(s))"
      });
    }
    for (var vc = 0; vc < videoTrackIndices.length; vc++) {
      if (videoTrackIndices[vc] >= qeSequence.numVideoTracks) {
        return JSON.stringify({
          ok: false,
          error: "videoTrackIndices[" + vc + "]=" + videoTrackIndices[vc] + " is out of range (sequence \"" + seq.name + "\" has " + qeSequence.numVideoTracks + " video track(s))"
        });
      }
    }

    var fps = getSequenceFps(seq);

    var parsedIntervals = [];
    for (var pi = 0; pi < args.intervals.length; pi++) {
      var rawInterval = args.intervals[pi];
      var startSeconds = timecodeToSeconds(rawInterval.start, fps);
      var endSeconds = timecodeToSeconds(rawInterval.end, fps);
      if (endSeconds <= startSeconds) {
        return JSON.stringify({ ok: false, error: "interval " + pi + " (\"" + rawInterval.start + "\" - \"" + rawInterval.end + "\") is empty or backwards" });
      }
      parsedIntervals.push({ start: rawInterval.start, end: rawInterval.end, startSeconds: startSeconds, endSeconds: endSeconds });
    }
    parsedIntervals.sort(function (a, b) { return a.startSeconds - b.startSeconds; });
    for (var oi = 1; oi < parsedIntervals.length; oi++) {
      if (parsedIntervals[oi].startSeconds < parsedIntervals[oi - 1].endSeconds) {
        return JSON.stringify({
          ok: false,
          error: "intervals overlap (\"" + parsedIntervals[oi - 1].start + "\" - \"" + parsedIntervals[oi - 1].end +
            "\" and \"" + parsedIntervals[oi].start + "\" - \"" + parsedIntervals[oi].end + "\")"
        });
      }
    }

    var tolerance = 0.5 / fps;
    var warnings = [];
    var totalSegmentsRemoved = 0;

    // Process last-to-first: applying a cut ripples everything after it,
    // so earlier (not-yet-processed) intervals' absolute positions stay
    // valid until their own turn comes.
    for (var idx = parsedIntervals.length - 1; idx >= 0; idx--) {
      var interval = parsedIntervals[idx];

      qeSequence.razor(toQeTimecode(interval.start));
      qeSequence.razor(toQeTimecode(interval.end));

      var audioTrack = qeSequence.getAudioTrackAt(args.audioTrackIndex);
      totalSegmentsRemoved += findAndRemoveInRange(
        audioTrack, interval.startSeconds, interval.endSeconds, tolerance, warnings, "Audio " + (args.audioTrackIndex + 1)
      );

      for (var vt = 0; vt < videoTrackIndices.length; vt++) {
        var videoTrack = qeSequence.getVideoTrackAt(videoTrackIndices[vt]);
        totalSegmentsRemoved += findAndRemoveInRange(
          videoTrack, interval.startSeconds, interval.endSeconds, tolerance, warnings, "Video " + (videoTrackIndices[vt] + 1)
        );
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        audioTrackIndex: args.audioTrackIndex,
        videoTrackIndices: videoTrackIndices,
        intervalsApplied: parsedIntervals.length,
        totalSegmentsRemoved: totalSegmentsRemoved,
        warnings: warnings
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
