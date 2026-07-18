// Command: overwrite-from-source → ppb_overwriteFromSource
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (secondsToTicksString,
// timeValueToSeconds, serializeTrackItem, findSequenceByName,
// ppbAddToTimeline_cleanupLinkedAudio) are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp source-monitor.ts
// overwrite_from_source — identical to insert-from-source except it calls
// seq.overwriteClip() (destroys whatever content is at the target
// position/duration instead of rippling it later). Destructive.
//
// Same auto-linked-audio trap and track-index-ignored caveat as
// insert-from-source/add-to-timeline — see those files' comments.
function ppb_overwriteFromSource(argsJson) {
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
    if (typeof args.trackIndex !== "number") {
      return JSON.stringify({ ok: false, error: "trackIndex is required" });
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

    var item = null;
    try {
      item = app.sourceMonitor.getProjectItem();
    } catch (e2) {
      return JSON.stringify({ ok: false, error: "app.sourceMonitor.getProjectItem() failed: " + e2.toString() });
    }
    if (!item) {
      return JSON.stringify({ ok: false, error: "no clip open in Source Monitor" });
    }
    var itemNodeId = null;
    try { itemNodeId = item.nodeId; } catch (e3) { itemNodeId = null; }

    var atSeconds = null;
    var posTicks = null;
    if (typeof args.atSeconds === "number" && !isNaN(args.atSeconds)) {
      atSeconds = args.atSeconds;
      posTicks = secondsToTicksString(atSeconds);
    } else {
      try {
        var playerPos = seq.getPlayerPosition();
        posTicks = playerPos.ticks;
        atSeconds = timeValueToSeconds(playerPos);
      } catch (e4) {
        return JSON.stringify({ ok: false, error: "atSeconds was not given and seq.getPlayerPosition() failed: " + e4.toString() });
      }
    }

    var trackCollection = args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var numTracks;
    try { numTracks = trackCollection.numTracks; } catch (e5) { numTracks = 0; }
    if (args.trackIndex >= numTracks) {
      return JSON.stringify({ ok: false, error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " " + args.trackType + " track(s)" });
    }
    var targetTrack = trackCollection[args.trackIndex];
    var trackClipCountBefore = null;
    try { trackClipCountBefore = targetTrack.clips.numItems; } catch (e6) { trackClipCountBefore = null; }

    var vIdx = args.trackType === "video" ? args.trackIndex : -1;
    var aIdx = args.trackType === "audio" ? args.trackIndex : -1;

    try {
      seq.overwriteClip(item, posTicks, vIdx, aIdx);
    } catch (e7) {
      return JSON.stringify({ ok: false, error: "seq.overwriteClip() failed: " + e7.toString() });
    }

    var trackClipCountAfter = null;
    try { trackClipCountAfter = targetTrack.clips.numItems; } catch (e8) { trackClipCountAfter = null; }

    var toleranceSeconds = 0.1;
    function ppbOverwriteFromSource_locate() {
      try {
        for (var t2 = 0; t2 < trackCollection.numTracks; t2++) {
          var scanTrack = trackCollection[t2];
          for (var c2 = 0; c2 < scanTrack.clips.numItems; c2++) {
            var candidate = scanTrack.clips[c2];
            var candNodeId = null;
            try { candNodeId = candidate.projectItem.nodeId; } catch (e9) { candNodeId = null; }
            if (candNodeId !== itemNodeId) {
              continue;
            }
            var candStart = null;
            try { candStart = timeValueToSeconds(candidate.start); } catch (e10) { candStart = null; }
            if (candStart !== null && Math.abs(candStart - atSeconds) <= toleranceSeconds) {
              return serializeTrackItem(candidate, t2, c2);
            }
          }
        }
      } catch (e11) {
        // fall through
      }
      return null;
    }

    var placedClip = ppbOverwriteFromSource_locate();
    var trackHonored = placedClip !== null && placedClip.trackIndex === args.trackIndex;

    var linkedAudioCleanup = { performed: false, removedCount: 0, removed: [] };
    if (args.trackType === "video") {
      var removedList = ppbAddToTimeline_cleanupLinkedAudio(seq, itemNodeId, atSeconds, toleranceSeconds);
      linkedAudioCleanup = { performed: true, removedCount: removedList.length, removed: removedList };
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        overwritten: true,
        trackType: args.trackType,
        requestedTrackIndex: args.trackIndex,
        actualTrackIndex: placedClip !== null ? placedClip.trackIndex : null,
        trackHonored: trackHonored,
        atSeconds: atSeconds,
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
