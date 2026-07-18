// Command: move-clip-to-track → ppb_moveClipToTrack
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, serializeTrackItem, timeValueToSeconds, ...) are
// already defined there.
//
// Moves a clip to a different track of the SAME media type. REWRITTEN
// 2026-07-17 after the probe session (see BUILD_FINDINGS.md
// corrections): the working signature on this build — found in the
// antipaster/Adobe-Premiere-Pro-MCP repo — is the 4-arg
//   qeClip.moveToTrack(videoTrackOffset, audioTrackOffset,
//                      timeShiftTicksString, bool)
// with RELATIVE track offsets (target − source) and the time shift as a
// ticks string ("0" = keep the clip's time position). Live-verified: it
// is a TRUE move — per-clip effects/keyframes survive (tested with a
// Gaussian Blur) and the start time is preserved. This replaces the old
// LOSSY remove()+overwrite() re-add workaround entirely.
//
// The video-clip form (offset in arg1) is live-verified; for audio
// clips the offset is assumed to belong in arg2 by symmetry — if the
// arg2 attempt produces no observable change, arg1 is tried as a
// fallback, with every attempt recorded.
//
// MUTATION RULE: verified by re-finding the clip on the TARGET track by
// name/media path near its original start time, plus per-track clip
// counts — never by trusting moveToTrack()'s return value.

function ppbMoveClipToTrack_trackCounts(trackCollection) {
  var counts = [];
  for (var t = 0; t < trackCollection.numTracks; t++) {
    counts.push(trackCollection[t].clips.numItems);
  }
  return counts;
}

function ppbMoveClipToTrack_findByNameNear(trackCollection, trackIndex, name, mediaPath, nearSeconds) {
  if (trackIndex >= trackCollection.numTracks) {
    return null;
  }
  var track = trackCollection[trackIndex];
  var numClips = track.clips.numItems;
  var best = null;
  var bestDelta = null;
  for (var i = 0; i < numClips; i++) {
    var c = track.clips[i];
    var cName = null;
    var cPath = null;
    try { cName = c.name; } catch (e) { cName = null; }
    try { cPath = c.projectItem.getMediaPath(); } catch (e2) { cPath = null; }
    if (cName === name || (mediaPath !== null && cPath === mediaPath)) {
      var startSeconds = null;
      try { startSeconds = timeValueToSeconds(c.start); } catch (e3) { startSeconds = null; }
      var delta = (startSeconds !== null && nearSeconds !== null) ? Math.abs(startSeconds - nearSeconds) : 0;
      if (best === null || delta < bestDelta) {
        best = { clip: c, index: i };
        bestDelta = delta;
      }
    }
  }
  return best;
}

function ppb_moveClipToTrack(argsJson) {
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
    if (typeof args.targetTrackIndex !== "number" || args.targetTrackIndex < 0 || Math.floor(args.targetTrackIndex) !== args.targetTrackIndex) {
      return JSON.stringify({ ok: false, error: "targetTrackIndex must be a non-negative integer" });
    }
    if (args.targetTrackIndex === args.trackIndex) {
      return JSON.stringify({ ok: false, error: "targetTrackIndex is the same as trackIndex — nothing to move" });
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
    if (args.targetTrackIndex >= trackCollection.numTracks) {
      return JSON.stringify({
        ok: false,
        error: "targetTrackIndex " + args.targetTrackIndex + " is out of range — sequence has " + trackCollection.numTracks + " " + args.trackType + " track(s)"
      });
    }

    var resolved = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    if (resolved.error) {
      return JSON.stringify({ ok: false, error: resolved.error });
    }
    var before = serializeTrackItem(resolved.clip, args.trackIndex, args.clipIndex);

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var qeSeq;
    try {
      qeSeq = qe.project.getActiveSequence();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() failed: " + e.toString() });
    }
    var qeResolved = resolveQeClip(qeSeq, args.trackType, args.trackIndex, args.clipIndex);
    if (qeResolved.error) {
      return JSON.stringify({ ok: false, error: qeResolved.error });
    }
    var qeClip = qeResolved.qeClip;
    if (typeof qeClip.moveToTrack !== "function") {
      return JSON.stringify({ ok: false, error: "qeClip.moveToTrack is not a function on this build" });
    }

    var offset = args.targetTrackIndex - args.trackIndex;

    // Arg order: (videoTrackOffset, audioTrackOffset, timeShiftTicks,
    // bool). The video slot is live-verified; the audio slot is assumed
    // by symmetry with an arg1 fallback.
    var forms = [];
    if (args.trackType === "video") {
      forms.push({ label: "moveToTrack(offset, 0, '0', false)", a: [offset, 0, "0", false] });
    } else {
      forms.push({ label: "moveToTrack(0, offset, '0', false)", a: [0, offset, "0", false] });
      forms.push({ label: "moveToTrack(offset, 0, '0', false) [audio fallback]", a: [offset, 0, "0", false] });
    }

    var attempts = [];
    var moved = false;
    var formUsed = null;
    for (var f = 0; f < forms.length && !moved; f++) {
      var countsBefore = ppbMoveClipToTrack_trackCounts(trackCollection);
      var att = { form: forms[f].label };
      try {
        qeClip.moveToTrack.apply(qeClip, forms[f].a);
        att.threw = false;
      } catch (e2) {
        att.threw = true;
        att.error = e2.toString();
      }
      var countsAfter = ppbMoveClipToTrack_trackCounts(trackCollection);
      att.effective = false;
      for (var t = 0; t < countsAfter.length; t++) {
        if (countsAfter[t] !== countsBefore[t]) { att.effective = true; }
      }
      attempts.push(att);
      if (att.effective) {
        moved = true;
        formUsed = forms[f].label;
      }
    }

    if (!moved) {
      return JSON.stringify({
        ok: false,
        error: "moveToTrack() produced no observable track change with any argument form tried — the clip was left in place",
        attempts: attempts,
        before: before
      });
    }

    var found = ppbMoveClipToTrack_findByNameNear(trackCollection, args.targetTrackIndex, before.name, before.mediaPath, before.startSeconds);
    var after = found ? serializeTrackItem(found.clip, args.targetTrackIndex, found.index) : null;

    var startDelta = (after && after.startSeconds !== null && before.startSeconds !== null)
      ? (after.startSeconds - before.startSeconds)
      : null;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        sourceTrackIndex: args.trackIndex,
        sourceClipIndex: args.clipIndex,
        targetTrackIndex: args.targetTrackIndex,
        formUsed: formUsed,
        attempts: attempts,
        before: before,
        after: after,
        placedOnTarget: after !== null,
        startSecondsDelta: startDelta,
        positionPreserved: startDelta !== null && Math.abs(startDelta) < 0.5,
        note: "TRUE move via qeClip.moveToTrack() — per-clip effects/keyframes survive (live-verified 2026-07-17), unlike the previous remove+overwrite workaround"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
