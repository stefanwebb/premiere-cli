// Command: overwrite-clip-at → ppb_overwriteClipAt
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, timeValueToSeconds,
// TICKS_PER_SECOND, ...) are already defined there.
//
// **Destructive.** Overwrites a bin project item onto the timeline at a
// given track/time, replacing whatever's already there. Ported from
// leancoderkavy's premiere-pro-mcp `overwrite_clip` tool (advanced.ts:
// `seq.overwriteClip(item, startTicks, trackIndex, audioTrackIndex)`),
// addressed here by trackType/trackIndex (this bridge's convention)
// rather than separate video/audio track-index args — the non-addressed
// side is passed `-1` per PREMIERE_API_NOTES.md ("pass -1 as the
// non-target index to place only the video or only the audio side").
//
// Signature is disputed across reference repos (seconds number vs Time
// object vs ticks string) — every plausible form is tried, then a
// track-level `track.overwriteClip(item, seconds)` fallback, then a QE
// `qeTrack.overwrite(item)` last resort (which has NO time argument at
// all and is only confirmed to land at track index 0 — a last resort,
// not a real substitute for time-addressed placement).
//
// **⚠️ Auto-linked audio trap** (PREMIERE_API_NOTES.md, hetpatel):
// overwriting a VIDEO clip whose source also has audio can silently
// place the linked audio too, potentially destroying existing audio on
// that track. This command snapshots every audio track before the
// video-side overwrite, and afterward scans for any NEW clip sharing the
// placed item's projectItem nodeId within 0.1s of the requested start —
// removing it (iterating backwards, since removal shifts indices) so the
// caller gets exactly the video-only placement they asked for. Any audio
// clip that WAS already there and got destroyed by the overwrite itself
// is NOT recoverable (undo is non-functional on this build) — this
// cleanup only removes auto-ADDED audio, it cannot undo auto-DESTROYED
// audio.

function ppbOverwriteClipAt_walkProjectItem(item, args, depth) {
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
      var found = ppbOverwriteClipAt_walkProjectItem(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbOverwriteClipAt_findProjectItem(nodeId, name) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbOverwriteClipAt_walkProjectItem(root.children[i], { nodeId: nodeId, name: nodeId ? null : name }, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppbOverwriteClipAt_snapshotTrack(track) {
  var out = [];
  var numClips;
  try {
    numClips = track.clips.numItems;
  } catch (e) {
    return out;
  }
  for (var i = 0; i < numClips; i++) {
    var c = track.clips[i];
    var entry = { nodeId: null, name: null, startSeconds: null, itemNodeId: null };
    try { entry.nodeId = c.nodeId; } catch (e2) { entry.nodeId = null; }
    try { entry.name = c.name; } catch (e3) { entry.name = null; }
    try { entry.startSeconds = timeValueToSeconds(c.start); } catch (e4) { entry.startSeconds = null; }
    try { entry.itemNodeId = c.projectItem.nodeId; } catch (e5) { entry.itemNodeId = null; }
    out.push(entry);
  }
  return out;
}

function ppb_overwriteClipAt(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasNodeId = typeof args.itemNodeId === "string" && args.itemNodeId.length > 0;
    var hasName = typeof args.itemName === "string" && args.itemName.length > 0;
    if (!hasNodeId && !hasName) {
      return JSON.stringify({ ok: false, error: "either itemNodeId or itemName is required" });
    }
    if (args.trackType !== "video" && args.trackType !== "audio") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" or \"audio\"" });
    }
    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.startSeconds !== "number" || isNaN(args.startSeconds) || args.startSeconds < 0) {
      return JSON.stringify({ ok: false, error: "startSeconds must be a non-negative number" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbOverwriteClipAt_findProjectItem(hasNodeId ? args.itemNodeId : null, hasNodeId ? null : args.itemName);
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given itemNodeId/itemName" });
    }
    var itemNodeId = null;
    try { itemNodeId = item.nodeId; } catch (e) { itemNodeId = null; }

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
    if (args.trackIndex >= trackCollection.numTracks) {
      return JSON.stringify({
        ok: false,
        error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + trackCollection.numTracks + " " + args.trackType + " track(s)"
      });
    }
    var targetTrack = trackCollection[args.trackIndex];

    // Snapshot every audio track before the mutation, so an auto-linked
    // clip added as a side effect of a video overwrite can be told apart
    // from audio that was already there.
    var audioTracksBefore = [];
    if (args.trackType === "video") {
      for (var at = 0; at < seq.audioTracks.numTracks; at++) {
        audioTracksBefore.push(ppbOverwriteClipAt_snapshotTrack(seq.audioTracks[at]));
      }
    }

    var ticksString = String(Math.round(args.startSeconds * TICKS_PER_SECOND));
    var timeObj = null;
    try {
      timeObj = new Time();
      timeObj.seconds = args.startSeconds;
    } catch (e) {
      timeObj = null;
    }
    var vIdx = args.trackType === "video" ? args.trackIndex : -1;
    var aIdx = args.trackType === "audio" ? args.trackIndex : -1;

    var attempts = [];
    var succeeded = false;
    var formUsed = null;

    if (typeof seq.overwriteClip === "function") {
      var seqForms = [
        { label: "seq.overwriteClip(item, ticksString, v, a)", fn: function () { seq.overwriteClip(item, ticksString, vIdx, aIdx); } },
        { label: "seq.overwriteClip(item, seconds, v, a)", fn: function () { seq.overwriteClip(item, args.startSeconds, vIdx, aIdx); } }
      ];
      if (timeObj !== null) {
        seqForms.push({ label: "seq.overwriteClip(item, TimeObject, v, a)", fn: function () { seq.overwriteClip(item, timeObj, vIdx, aIdx); } });
      }
      for (var i = 0; i < seqForms.length && !succeeded; i++) {
        try {
          seqForms[i].fn();
          attempts.push({ form: seqForms[i].label, success: true });
          succeeded = true;
          formUsed = seqForms[i].label;
        } catch (e) {
          attempts.push({ form: seqForms[i].label, success: false, error: e.toString() });
        }
      }
    }

    if (!succeeded && typeof targetTrack.overwriteClip === "function") {
      var trackForms = [
        { label: "track.overwriteClip(item, seconds)", fn: function () { targetTrack.overwriteClip(item, args.startSeconds); } }
      ];
      if (timeObj !== null) {
        trackForms.push({ label: "track.overwriteClip(item, TimeObject)", fn: function () { targetTrack.overwriteClip(item, timeObj); } });
      }
      for (var j = 0; j < trackForms.length && !succeeded; j++) {
        try {
          trackForms[j].fn();
          attempts.push({ form: trackForms[j].label, success: true });
          succeeded = true;
          formUsed = trackForms[j].label;
        } catch (e) {
          attempts.push({ form: trackForms[j].label, success: false, error: e.toString() });
        }
      }
    }

    var qeFallbackWarning = null;
    if (!succeeded) {
      try {
        ensureQEEnabled();
        activateSequenceForQE(seq);
        if (typeof qe !== "undefined" && qe.project) {
          var qeSeq = qe.project.getActiveSequence();
          var qeTrack = args.trackType === "video" ? qeSeq.getVideoTrackAt(args.trackIndex) : qeSeq.getAudioTrackAt(args.trackIndex);
          if (qeTrack && typeof qeTrack.overwrite === "function") {
            qeTrack.overwrite(item);
            attempts.push({ form: "qeTrack.overwrite(item)", success: true });
            succeeded = true;
            formUsed = "qeTrack.overwrite(item)";
            qeFallbackWarning = "used the QE fallback, which has NO time argument — the item was placed wherever qeTrack.overwrite() lands on this build (confirmed track-start-of-empty-track behavior per QE_DOM_NOTES.md), NOT necessarily at the requested startSeconds. Check the reported placedStartSeconds below.";
          }
        }
      } catch (e) {
        attempts.push({ form: "qeTrack.overwrite(item)", success: false, error: e.toString() });
      }
    }

    if (!succeeded) {
      return JSON.stringify({
        ok: false,
        error: "could not overwrite the clip onto the timeline with any known argument form or the QE fallback",
        attempts: attempts
      });
    }

    // Find the newly-placed clip on the target track nearest the
    // requested start time (nodeId is fresh, so match by proximity).
    var placedStartSeconds = null;
    var placedName = null;
    try {
      var numClipsAfter = targetTrack.clips.numItems;
      var bestDelta = null;
      for (var k = 0; k < numClipsAfter; k++) {
        var candidate = targetTrack.clips[k];
        var candidateStart = null;
        try { candidateStart = timeValueToSeconds(candidate.start); } catch (e2) { candidateStart = null; }
        if (candidateStart === null) {
          continue;
        }
        var delta = Math.abs(candidateStart - args.startSeconds);
        if (bestDelta === null || delta < bestDelta) {
          bestDelta = delta;
          placedStartSeconds = candidateStart;
          try { placedName = candidate.name; } catch (e3) { placedName = null; }
        }
      }
    } catch (e) {
      // leave placedStartSeconds/placedName null
    }

    // Auto-linked-audio cleanup: scan every audio track for a clip that
    // wasn't in the "before" snapshot, shares the placed item's
    // projectItem nodeId, and sits within 0.1s of the requested start —
    // remove it, iterating tracks/clips backwards since removal shifts
    // later indices.
    var removedAutoLinkedAudio = [];
    if (args.trackType === "video" && itemNodeId !== null) {
      for (var at2 = seq.audioTracks.numTracks - 1; at2 >= 0; at2--) {
        var audioTrack = seq.audioTracks[at2];
        var beforeList = audioTracksBefore[at2] || [];
        var numAudioClips;
        try {
          numAudioClips = audioTrack.clips.numItems;
        } catch (e4) {
          numAudioClips = 0;
        }
        for (var ci = numAudioClips - 1; ci >= 0; ci--) {
          var aClip = audioTrack.clips[ci];
          var aStart = null;
          var aItemNodeId = null;
          try { aStart = timeValueToSeconds(aClip.start); } catch (e5) { aStart = null; }
          try { aItemNodeId = aClip.projectItem.nodeId; } catch (e6) { aItemNodeId = null; }
          if (aItemNodeId !== itemNodeId || aStart === null || Math.abs(aStart - args.startSeconds) > 0.1) {
            continue;
          }
          // Was this clip already there before the overwrite? Match by
          // nodeId (existing clips keep theirs; a freshly auto-linked
          // clip has a nodeId not present in the "before" snapshot).
          var aNodeId = null;
          try { aNodeId = aClip.nodeId; } catch (e7) { aNodeId = null; }
          var wasPresentBefore = false;
          for (var bi = 0; bi < beforeList.length; bi++) {
            if (beforeList[bi].nodeId === aNodeId) {
              wasPresentBefore = true;
              break;
            }
          }
          if (wasPresentBefore) {
            continue;
          }
          var removedOk = false;
          try {
            aClip.remove(false, false);
            removedOk = true;
          } catch (e8) {
            removedOk = false;
          }
          removedAutoLinkedAudio.push({
            audioTrackIndex: at2,
            startSeconds: aStart,
            removed: removedOk
          });
        }
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        itemName: (function () { try { return item.name; } catch (e9) { return null; } })(),
        itemNodeId: itemNodeId,
        requestedStartSeconds: args.startSeconds,
        formUsed: formUsed,
        attempts: attempts,
        placedStartSeconds: placedStartSeconds,
        placedName: placedName,
        verified: placedStartSeconds !== null && Math.abs(placedStartSeconds - args.startSeconds) < 0.5,
        removedAutoLinkedAudio: removedAutoLinkedAudio,
        qeFallbackWarning: qeFallbackWarning,
        warning: "destructive: this overwrites whatever was already on the target track at this position, and undo is non-functional on this build."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
