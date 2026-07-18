// Command: batch-rename-clips → ppb_batchRenameClips
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, qeFindNthNonEmptyClip, ...) are
// already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp `batch_rename_clips` tool
// (track-targeting.ts), which renames via QE `qeClip.setName()` only (no
// standard-DOM fallback, unlike the single-clip rename-clip command) —
// matched here for fidelity to the reference's actual renaming path.
// `newNameTemplate` supports "{n}" (sequential counter, starting at
// `startNumber`, default 1) and "{name}" (the clip's existing name),
// applied via simple split/join (no regex). `nameContains` optionally
// filters which clips on the track are renamed (case-insensitive substring
// match against the clip's CURRENT name, checked before the counter
// advances so skipped clips don't consume a number). Capped at 200 renames
// per call to bound QE call volume. Every clip's rename is verified
// individually via a clip.name read-back — never trusted from setName()'s
// own return value.
var BATCH_RENAME_CLIPS_MAX = 200;

function ppb_batchRenameClips(argsJson) {
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
    if (typeof args.newNameTemplate !== "string" || args.newNameTemplate.length === 0) {
      return JSON.stringify({ ok: false, error: "newNameTemplate must be a non-empty string" });
    }
    var startNumber = 1;
    if (typeof args.startNumber === "number" && !isNaN(args.startNumber)) {
      startNumber = args.startNumber;
    }
    var nameContains = null;
    if (typeof args.nameContains === "string" && args.nameContains.length > 0) {
      nameContains = args.nameContains.toLowerCase();
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
    var numTracks = trackCollection.numTracks;
    if (args.trackIndex >= numTracks) {
      return JSON.stringify({
        ok: false,
        error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " " + args.trackType + " track(s)"
      });
    }

    var track = trackCollection[args.trackIndex];
    var numClips = track.clips.numItems;

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
    var qeTrack;
    try {
      qeTrack = args.trackType === "video" ? qeSeq.getVideoTrackAt(args.trackIndex) : qeSeq.getAudioTrackAt(args.trackIndex);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "QE track lookup failed: " + e.toString() });
    }
    if (!qeTrack) {
      return JSON.stringify({ ok: false, error: "QE track not found at index " + args.trackIndex });
    }

    var results = [];
    var renamed = 0;
    var skippedByFilter = 0;
    var cappedAtLimit = false;
    var num = startNumber;

    for (var c = 0; c < numClips; c++) {
      if (renamed >= BATCH_RENAME_CLIPS_MAX) {
        cappedAtLimit = true;
        break;
      }

      var clip = track.clips[c];
      var oldName = null;
      try { oldName = clip.name; } catch (e) { oldName = null; }

      if (nameContains !== null) {
        var haystack = oldName === null ? "" : String(oldName).toLowerCase();
        if (haystack.indexOf(nameContains) === -1) {
          skippedByFilter++;
          continue;
        }
      }

      var newName = args.newNameTemplate.split("{n}").join(String(num)).split("{name}").join(oldName === null ? "" : oldName);

      var entry = { clipIndex: c, previousValue: oldName, requestedValue: newName, newValue: null, verified: false };

      try {
        var qeClip = qeFindNthNonEmptyClip(qeTrack, c);
        if (!qeClip) {
          entry.error = "could not locate corresponding QE clip";
        } else {
          qeClip.setName(newName);
        }
      } catch (e) {
        entry.error = e.toString();
      }

      try { entry.newValue = clip.name; } catch (e) { entry.newValue = null; }
      entry.verified = entry.newValue === newName;
      if (entry.verified) {
        renamed++;
      }

      num++;
      results.push(entry);
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      newNameTemplate: args.newNameTemplate,
      nameContains: args.nameContains || null,
      totalClipsOnTrack: numClips,
      skippedByFilter: skippedByFilter,
      renamed: renamed,
      cappedAtLimit: cappedAtLimit,
      results: results
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
