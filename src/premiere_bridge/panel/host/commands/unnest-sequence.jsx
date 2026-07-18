// Command: unnest-sequence → ppb_unnestSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's sequence.ts
// unnest_sequence — a real (non-stub) implementation, so this is a full
// port rather than a skip. Replaces a nested-sequence clip on the
// timeline with copies of the nested sequence's own clips, addressed by
// the outer clip's nodeId (not trackType/trackIndex/clipIndex, since the
// nested clip could be on either track type and the reference itself
// only ever addresses it by nodeId).
//
// Algorithm (matches the reference): find the timeline clip by nodeId,
// confirm its projectItem resolves to another open sequence (nodeId/name
// matched against app.project.sequences — the "is this a nested sequence
// clip" test), remove the nested-sequence clip, then re-insert each of
// the nested sequence's own clips at an offset position (outer clip's own
// start + the nested clip's own start) on the corresponding track.
//
// Semi-destructive/structural: removes the nested-sequence clip outright
// before re-inserting its contents — if insertion partway fails, the
// timeline is left in a partially-unnested state (documented in the
// result, not silently swallowed). Undo is non-functional on this build.
//
// Verification: reports the outer clip removal AND, per re-inserted
// clip, whether seq.insertClip() was reached without throwing — plus a
// final total-clip-count comparison across the whole sequence (never
// trusting insertClip()'s own return value).
function ppb_findTimelineClipByNodeId(seq, nodeId) {
  function scan(tracks, trackType) {
    for (var t = 0; t < tracks.numTracks; t++) {
      for (var c = 0; c < tracks[t].clips.numItems; c++) {
        var clip = tracks[t].clips[c];
        var id = null;
        try { id = clip.nodeId; } catch (e) { id = null; }
        if (id === nodeId) {
          return { clip: clip, trackType: trackType, trackIndex: t, clipIndex: c };
        }
      }
    }
    return null;
  }
  return scan(seq.videoTracks, "video") || scan(seq.audioTracks, "audio");
}

function ppb_countAllClipsUnnestSequence(seq) {
  var total = 0;
  try {
    for (var v = 0; v < seq.videoTracks.numTracks; v++) {
      total += seq.videoTracks[v].clips.numItems;
    }
  } catch (e) {
    // best-effort
  }
  try {
    for (var a = 0; a < seq.audioTracks.numTracks; a++) {
      total += seq.audioTracks[a].clips.numItems;
    }
  } catch (e) {
    // best-effort
  }
  return total;
}

function ppb_unnestSequence(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.nodeId || typeof args.nodeId !== "string") {
      return JSON.stringify({ ok: false, error: "nodeId is required (node ID of the nested-sequence clip on the timeline)" });
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

    var found = ppb_findTimelineClipByNodeId(seq, args.nodeId);
    if (!found) {
      return JSON.stringify({ ok: false, error: "no clip with nodeId \"" + args.nodeId + "\" found on sequence \"" + seq.name + "\"" });
    }
    var clip = found.clip;
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var projectItem = null;
    try { projectItem = clip.projectItem; } catch (e) { projectItem = null; }
    if (!projectItem) {
      return JSON.stringify({ ok: false, error: "clip \"" + clipName + "\" has no projectItem — cannot resolve it to a nested sequence" });
    }

    var nestedSeq = null;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      var s = app.project.sequences[i];
      var sName = null;
      try { sName = s.name; } catch (e) { sName = null; }
      var sId = null;
      try { sId = s.sequenceID; } catch (e) { sId = null; }
      var itName = null;
      try { itName = projectItem.name; } catch (e) { itName = null; }
      var itNodeId = null;
      try { itNodeId = projectItem.nodeId; } catch (e) { itNodeId = null; }
      if (sName === itName || sId === itNodeId) {
        nestedSeq = s;
        break;
      }
    }
    if (!nestedSeq) {
      return JSON.stringify({ ok: false, error: "clip \"" + clipName + "\" is not a nested sequence (its projectItem doesn't match any open sequence)" });
    }

    var startTicks = null;
    try { startTicks = clip.start.ticks; } catch (e) { startTicks = null; }
    if (startTicks === null) {
      return JSON.stringify({ ok: false, error: "could not read the nested clip's own start time" });
    }
    var trackIndex = found.trackIndex;
    var trackType = found.trackType;

    var countBefore = ppb_countAllClipsUnnestSequence(seq);

    var removeError = null;
    try {
      clip.remove(false, false);
    } catch (e) {
      removeError = e.toString();
    }
    if (removeError !== null) {
      return JSON.stringify({ ok: false, error: "failed to remove the nested-sequence clip: " + removeError });
    }

    var addedClips = [];
    var insertErrors = [];
    var tracks = trackType === "video" ? nestedSeq.videoTracks : nestedSeq.audioTracks;
    for (var t = 0; t < tracks.numTracks; t++) {
      var track = tracks[t];
      for (var c = 0; c < track.clips.numItems; c++) {
        var nestedClip = track.clips[c];
        var nestedProjectItem = null;
        try { nestedProjectItem = nestedClip.projectItem; } catch (e) { nestedProjectItem = null; }
        if (!nestedProjectItem) {
          continue;
        }
        var nestedName = null;
        try { nestedName = nestedClip.name; } catch (e) { nestedName = null; }

        var insertTime = null;
        try {
          insertTime = (parseFloat(startTicks) + parseFloat(nestedClip.start.ticks)).toString();
        } catch (e) {
          insertErrors.push({ clip: nestedName, error: "could not compute insert time: " + e.toString() });
          continue;
        }
        var targetTrack = trackIndex + t;

        try {
          if (trackType === "video") {
            seq.insertClip(nestedProjectItem, insertTime, targetTrack, targetTrack);
          } else {
            seq.insertClip(nestedProjectItem, insertTime, 0, targetTrack);
          }
          addedClips.push(nestedName);
        } catch (e2) {
          insertErrors.push({ clip: nestedName, error: e2.toString() });
        }
      }
    }

    var countAfter = ppb_countAllClipsUnnestSequence(seq);

    return JSON.stringify({
      ok: insertErrors.length === 0,
      result: {
        sequenceName: seq.name,
        unnestedClipName: clipName,
        nestedSequenceName: nestedSeq.name,
        trackType: trackType,
        trackIndex: trackIndex,
        addedClips: addedClips,
        addedCount: addedClips.length,
        insertErrors: insertErrors,
        countBefore: countBefore,
        countAfter: countAfter
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
