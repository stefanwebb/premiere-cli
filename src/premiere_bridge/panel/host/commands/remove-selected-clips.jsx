// Command: remove-selected-clips → ppb_removeSelectedClips
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// serializeTrackItem, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's track-targeting.ts
// remove_selected_clips. Removes every currently-selected clip (video+
// audio) via clip.remove(rippleBool, /*alignToVideo*/true). Selected
// clips are collected BACKWARDS per track (highest clipIndex first) so
// that removing one clip never invalidates the still-pending indices of
// clips before it on the same track — a ripple=true removal shifts every
// later clip on that track.
//
// Destructive: removed clips cannot be restored (undo is non-functional
// on this build per README.md) — verify on a duplicate/throwaway
// sequence before running against real footage.
//
// Verification: total clip count across all tracks, before/after, plus a
// per-clip removed/failed breakdown (never trusting remove()'s own return
// value — same rule as every other mutation command in this panel).
function ppb_countAllClips(seq) {
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

function ppb_removeSelectedClips(argsJson) {
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

    var ripple = args.ripple === true;

    var toRemove = [];
    function collectSelectedBackwards(tracks, trackType) {
      for (var t = 0; t < tracks.numTracks; t++) {
        for (var c = tracks[t].clips.numItems - 1; c >= 0; c--) {
          var clip = tracks[t].clips[c];
          var isSel = false;
          try { isSel = clip.isSelected(); } catch (e) { isSel = false; }
          if (isSel) {
            var name = null;
            try { name = clip.name; } catch (e2) { name = null; }
            toRemove.push({ clip: clip, trackType: trackType, trackIndex: t, clipIndex: c, name: name });
          }
        }
      }
    }
    collectSelectedBackwards(seq.videoTracks, "video");
    collectSelectedBackwards(seq.audioTracks, "audio");

    var countBefore = ppb_countAllClips(seq);

    var results = [];
    var removedCount = 0;
    for (var i = 0; i < toRemove.length; i++) {
      var entry = toRemove[i];
      var removeError = null;
      try {
        entry.clip.remove(ripple, true);
        removedCount++;
      } catch (e) {
        removeError = e.toString();
      }
      results.push({
        trackType: entry.trackType,
        trackIndex: entry.trackIndex,
        clipIndex: entry.clipIndex,
        name: entry.name,
        error: removeError
      });
    }

    var countAfter = ppb_countAllClips(seq);

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        ripple: ripple,
        selectedCount: toRemove.length,
        removedCount: removedCount,
        countBefore: countBefore,
        countAfter: countAfter,
        verified: countAfter === countBefore - removedCount,
        results: results
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
