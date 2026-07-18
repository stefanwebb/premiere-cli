// Command: add-to-timeline → ppb_addToTimeline
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// secondsToTicksString, timeValueToSeconds, serializeTrackItem, ...) are
// already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp add_to_timeline tool.
// UPDATED 2026-07-17 after the probe session (see BUILD_FINDINGS.md
// corrections): placement now goes through the TRACK object's own
// method — seq.videoTracks[i].insertClip(item, TimeObject) /
// .overwriteClip(item, TimeObject) — which live-verifiably HONORS the
// track index, unlike the sequence-level seq.insertClip()/
// overwriteClip(), which ignore their vIdx argument on this build (the
// pattern both the antipaster and hetpatel repos converged on). The
// sequence-level call (-1 as the non-addressed track index) is kept as
// a fallback if the track method is missing or throws.
//
// ⚠️ AUTO-LINKED AUDIO TRAP (PREMIERE_API_NOTES.md): placing a video clip
// whose source projectItem also has audio can silently place the linked
// audio on some audio track too, even though we passed audioTrackIndex
// -1 — and if that lands on top of existing content it can destroy it.
// Per hetpatel's fix, after any video-track placement we scan every
// audio track for a clip referencing the SAME projectItem.nodeId within
// 0.1s of the requested startSeconds and remove it (iterating backwards
// per track, since removal shifts later indices) — the caller only asked
// for a video placement, so any such auto-placed audio is unwanted.
//
// MUTATION RULE: every mutation here is verified by re-reading the
// timeline afterward — the target track's clip count before/after, and
// (best-effort) the newly-placed clip's own serialized state — rather
// than trusting insertClip()/overwriteClip()'s own (undocumented) return
// value.

function ppbFindItemAddToTimeline_walk(item, args, depth) {
  if (depth > 32) {
    return null;
  }
  var isBin = false;
  try {
    isBin = typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    isBin = false;
  }
  var matched = false;
  if (args.nodeId !== null) {
    try { matched = item.nodeId === args.nodeId; } catch (e) { matched = false; }
  } else if (args.name !== null) {
    try { matched = item.name === args.name; } catch (e) { matched = false; }
  }
  if (matched) {
    return item;
  }
  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbFindItemAddToTimeline_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemAddToTimeline_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemAddToTimeline_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

// Removes every audio clip on ANY audio track whose source projectItem
// matches nodeId and whose start is within toleranceSeconds of
// targetStartSeconds — the auto-linked-audio cleanup described above.
// Iterates each track's clips backwards so index shifts from an earlier
// removal never skip a later match. Returns an array of
// {trackIndex, name, startSeconds} for whatever was removed.
function ppbAddToTimeline_cleanupLinkedAudio(seq, nodeId, targetStartSeconds, toleranceSeconds) {
  var removed = [];
  var numAudioTracks;
  try {
    numAudioTracks = seq.audioTracks.numTracks;
  } catch (e) {
    return removed;
  }

  for (var t = 0; t < numAudioTracks; t++) {
    var track = seq.audioTracks[t];
    var numClips;
    try {
      numClips = track.clips.numItems;
    } catch (e2) {
      continue;
    }
    for (var c = numClips - 1; c >= 0; c--) {
      var clip = track.clips[c];
      var clipNodeId = null;
      try { clipNodeId = clip.projectItem.nodeId; } catch (e3) { clipNodeId = null; }
      if (clipNodeId !== nodeId) {
        continue;
      }
      var clipStart = null;
      try { clipStart = timeValueToSeconds(clip.start); } catch (e4) { clipStart = null; }
      if (clipStart === null || Math.abs(clipStart - targetStartSeconds) > toleranceSeconds) {
        continue;
      }
      var clipName = null;
      try { clipName = clip.name; } catch (e5) { clipName = null; }
      try {
        clip.remove(false, false);
        removed.push({ trackIndex: t, name: clipName, startSeconds: clipStart });
      } catch (e6) {
        // leave it — best-effort cleanup, don't fail the whole command over it
      }
    }
  }
  return removed;
}

function ppb_addToTimeline(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasNodeId = typeof args.nodeId === "string" && args.nodeId.length > 0;
    var hasName = typeof args.name === "string" && args.name.length > 0;
    if (!hasNodeId && !hasName) {
      return JSON.stringify({ ok: false, error: "either nodeId or name is required to identify the project item" });
    }
    if (args.trackType !== "video" && args.trackType !== "audio") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" or \"audio\"" });
    }
    if (typeof args.trackIndex !== "number") {
      return JSON.stringify({ ok: false, error: "trackIndex is required" });
    }
    if (typeof args.startSeconds !== "number") {
      return JSON.stringify({ ok: false, error: "startSeconds is required" });
    }
    if (args.mode !== "insert" && args.mode !== "overwrite") {
      return JSON.stringify({ ok: false, error: "mode must be \"insert\" or \"overwrite\"" });
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

    var item = ppbFindItemAddToTimeline_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }
    var itemNodeId = null;
    try { itemNodeId = item.nodeId; } catch (e7) { itemNodeId = null; }

    var trackCollection = args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var numTracks;
    try { numTracks = trackCollection.numTracks; } catch (e8) { numTracks = 0; }
    if (args.trackIndex >= numTracks) {
      return JSON.stringify({ ok: false, error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " " + args.trackType + " track(s)" });
    }
    var targetTrack = trackCollection[args.trackIndex];
    var trackClipCountBefore = null;
    try { trackClipCountBefore = targetTrack.clips.numItems; } catch (e9) { trackClipCountBefore = null; }

    var vIdx = args.trackType === "video" ? args.trackIndex : -1;
    var aIdx = args.trackType === "audio" ? args.trackIndex : -1;
    var startTicks = secondsToTicksString(args.startSeconds);
    var methodName = args.mode === "insert" ? "insertClip" : "overwriteClip";

    // Track-object placement first — honors the track (live-verified
    // 2026-07-17 with a Time object on video tracks 1 and 2).
    var placementAttempts = [];
    var placedVia = null;
    if (typeof targetTrack[methodName] === "function") {
      var timeObj = new Time();
      timeObj.seconds = args.startSeconds;
      try {
        targetTrack[methodName](item, timeObj);
        placementAttempts.push({ method: "track." + methodName + "(item, TimeObject)", success: true });
        placedVia = "track." + methodName;
      } catch (e10a) {
        placementAttempts.push({ method: "track." + methodName + "(item, TimeObject)", success: false, error: e10a.toString() });
      }
    } else {
      placementAttempts.push({ method: "track." + methodName, success: false, error: "not a function on this build" });
    }

    // Fallback: sequence-level call — known on this build to ignore its
    // video-track index (clip lands on a build-chosen track).
    if (placedVia === null) {
      try {
        if (args.mode === "insert") {
          seq.insertClip(item, startTicks, vIdx, aIdx);
        } else {
          seq.overwriteClip(item, startTicks, vIdx, aIdx);
        }
        placementAttempts.push({ method: "seq." + methodName + "(item, ticks, vIdx, aIdx)", success: true });
        placedVia = "seq." + methodName;
      } catch (e10) {
        return JSON.stringify({
          ok: false,
          error: "both track-level and sequence-level " + methodName + "() failed — see attempts",
          attempts: placementAttempts
        });
      }
    }

    var trackClipCountAfter = null;
    try { trackClipCountAfter = targetTrack.clips.numItems; } catch (e11) { trackClipCountAfter = null; }

    // Locate the newly-placed clip by matching projectItem + requested
    // start time — scanning ALL tracks of the type, not just the
    // requested one: live-tested 2026-07-17, seq.overwriteClip() IGNORES
    // its vIdx argument on this Premiere 2026 build (clips landed on V1
    // regardless of vIdx 0 or 1, targeting on or off), so where the clip
    // actually went must be discovered, never assumed.
    var toleranceSeconds = 0.1;
    function ppbAddToTimeline_locate() {
      try {
        for (var t2 = 0; t2 < trackCollection.numTracks; t2++) {
          var scanTrack = trackCollection[t2];
          for (var c2 = 0; c2 < scanTrack.clips.numItems; c2++) {
            var candidate = scanTrack.clips[c2];
            var candNodeId = null;
            try { candNodeId = candidate.projectItem.nodeId; } catch (e12) { candNodeId = null; }
            if (candNodeId !== itemNodeId) {
              continue;
            }
            var candStart = null;
            try { candStart = timeValueToSeconds(candidate.start); } catch (e13) { candStart = null; }
            if (candStart !== null && Math.abs(candStart - args.startSeconds) <= toleranceSeconds) {
              return serializeTrackItem(candidate, t2, c2);
            }
          }
        }
      } catch (e14) {
        // fall through
      }
      return null;
    }

    var placedClip = ppbAddToTimeline_locate();

    // The track-object path honors the track; the sequence-level
    // fallback doesn't (build bug) — either way, report the ACTUAL track
    // the clip landed on and flag whether the request was honored.
    var trackHonored = placedClip !== null && placedClip.trackIndex === args.trackIndex;

    var linkedAudioCleanup = { performed: false, removedCount: 0, removed: [] };
    if (args.trackType === "video") {
      var removedList = ppbAddToTimeline_cleanupLinkedAudio(seq, itemNodeId, args.startSeconds, toleranceSeconds);
      linkedAudioCleanup = { performed: true, removedCount: removedList.length, removed: removedList };
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        added: true,
        mode: args.mode,
        placedVia: placedVia,
        placementAttempts: placementAttempts,
        trackType: args.trackType,
        requestedTrackIndex: args.trackIndex,
        actualTrackIndex: placedClip !== null ? placedClip.trackIndex : null,
        trackHonored: trackHonored,
        startSeconds: args.startSeconds,
        item: { name: (function () { try { return item.name; } catch (e) { return null; } })(), nodeId: itemNodeId },
        placedClip: placedClip,
        trackClipCountBefore: trackClipCountBefore,
        trackClipCountAfter: trackClipCountAfter,
        linkedAudioCleanup: linkedAudioCleanup
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
