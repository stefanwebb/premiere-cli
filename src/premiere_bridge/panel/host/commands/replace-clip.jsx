// Command: replace-clip → ppb_replaceClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeTrackItem, secondsToTicksString,
// timeValueToSeconds, ...) are already defined there.
//
// DESTRUCTIVE: removes the addressed clip (clip.remove(false, false) —
// lift, not ripple, so the timeline position it occupied is preserved)
// and re-inserts the replacement projectItem at that same start time via
// seq.insertClip() — ported from leancoderkavy's premiere-pro-mcp
// replace_clip tool, re-addressed to this panel's
// trackType/trackIndex/clipIndex convention and given its own project-
// item addressing (nodeId/name) for the replacement, matching
// get-item-metadata's convention. Undo is NON-FUNCTIONAL on this build —
// if the replacement projectItem is wrong, the ORIGINAL clip's own
// details (returned as `before`) are the only path to manually reinsert
// it.
//
// MUTATION RULE: verified by re-finding a clip at the same start time on
// the same track afterward and confirming its projectItem's name/media
// path changed to the replacement's.

function ppbFindItemReplaceClip_walk(item, args, depth) {
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
      var found = ppbFindItemReplaceClip_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemReplaceClip_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemReplaceClip_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_replaceClip(argsJson) {
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
    if (typeof args.trackIndex !== "number" || typeof args.clipIndex !== "number") {
      return JSON.stringify({ ok: false, error: "trackIndex and clipIndex are required" });
    }
    var hasNodeId = typeof args.replacementNodeId === "string" && args.replacementNodeId.length > 0;
    var hasName = typeof args.replacementName === "string" && args.replacementName.length > 0;
    if (!hasNodeId && !hasName) {
      return JSON.stringify({ ok: false, error: "either replacementNodeId or replacementName is required" });
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

    var resolved = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    if (resolved.error) {
      return JSON.stringify({ ok: false, error: resolved.error });
    }
    var clip = resolved.clip;

    var replacementItem = ppbFindItemReplaceClip_resolve({
      nodeId: hasNodeId ? args.replacementNodeId : null,
      name: hasNodeId ? null : args.replacementName
    });
    if (!replacementItem) {
      return JSON.stringify({ ok: false, error: "no replacement project item found matching the given replacementNodeId/replacementName" });
    }

    var before = serializeTrackItem(clip, args.trackIndex, args.clipIndex);
    if (before.startSeconds === null) {
      return JSON.stringify({ ok: false, error: "could not read the clip's own start time — refusing to remove it without a safe reinsertion point", removedClip: null });
    }
    var startSeconds = before.startSeconds;

    var trackCollection = args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var track = trackCollection[args.trackIndex];

    try {
      clip.remove(false, false);
    } catch (e2) {
      return JSON.stringify({ ok: false, error: "clip.remove() failed while removing the original clip: " + e2.toString(), previousValue: before });
    }

    var vIdx = args.trackType === "video" ? args.trackIndex : -1;
    var aIdx = args.trackType === "audio" ? args.trackIndex : -1;
    var startTicks = secondsToTicksString(startSeconds);

    try {
      seq.insertClip(replacementItem, startTicks, vIdx, aIdx);
    } catch (e3) {
      return JSON.stringify({
        ok: false,
        error: "the original clip was already removed but seq.insertClip() of the replacement failed: " + e3.toString() + " — the track now has a gap; previousValue below is the only path to manually reinsert the original",
        previousValue: before
      });
    }

    var replacementNodeId = null;
    try { replacementNodeId = replacementItem.nodeId; } catch (e4) { replacementNodeId = null; }

    var newClip = null;
    var toleranceSeconds = 0.1;
    try {
      for (var c = 0; c < track.clips.numItems; c++) {
        var candidate = track.clips[c];
        var candNodeId = null;
        try { candNodeId = candidate.projectItem.nodeId; } catch (e5) { candNodeId = null; }
        if (candNodeId !== replacementNodeId) {
          continue;
        }
        var candStart = null;
        try { candStart = timeValueToSeconds(candidate.start); } catch (e6) { candStart = null; }
        if (candStart !== null && Math.abs(candStart - startSeconds) <= toleranceSeconds) {
          newClip = serializeTrackItem(candidate, args.trackIndex, c);
          break;
        }
      }
    } catch (e7) {
      newClip = null;
    }

    var verified = newClip !== null && newClip.mediaPath !== null &&
      (function () { try { return newClip.mediaPath === replacementItem.getMediaPath(); } catch (e) { return false; } })();

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        previousValue: before,
        newValue: newClip,
        replacementItem: { name: (function () { try { return replacementItem.name; } catch (e) { return null; } })(), nodeId: replacementNodeId },
        verified: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
