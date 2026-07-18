// Command: batch-set-clips-enabled → ppb_batchSetClipsEnabled
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `batch_enable_disable` tool (track-targeting.ts), which supports
// target: "selected"|"track"|"all" — collapsed here to two filters
// (`nameContains`, `trackType`) since this bridge otherwise always exposes
// filters rather than a target enum (matching batch-rename-clips'
// convention); omit both to affect every clip in the sequence, matching
// the reference's "all" target. There is no `target: "selected"`
// equivalent — use select-clips-by-name / set-clip-selection first, then
// filter batch-set-clips-enabled by the same `nameContains` if that
// combination is needed. Same `clip.disabled`/`setDisabled()` dual-probe
// as set-clip-enabled, capped at 200 clips per call, with a per-track
// read-back verification summary rather than trusting the mutation calls.
var BATCH_SET_CLIPS_ENABLED_MAX = 200;

function ppb_batchSetClipsEnabledOnTrack(track, trackType, trackIndex, nameContainsLower, enabled, budget, results) {
  var affected = 0;
  var verifiedCount = 0;
  var numClips = track.clips.numItems;
  var requestedDisabled = !enabled;

  for (var c = 0; c < numClips; c++) {
    if (budget.remaining <= 0) {
      budget.cappedAtLimit = true;
      break;
    }

    var clip = track.clips[c];
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    if (nameContainsLower !== null) {
      var haystack = clipName === null ? "" : String(clipName).toLowerCase();
      if (haystack.indexOf(nameContainsLower) === -1) {
        continue;
      }
    }

    var entry = { trackType: trackType, trackIndex: trackIndex, clipIndex: c, clipName: clipName, verified: false };

    try {
      clip.disabled = requestedDisabled;
    } catch (e1) {
      try {
        clip.setDisabled(requestedDisabled);
      } catch (e2) {
        entry.error = e1.toString() + " / " + e2.toString();
      }
    }

    var newDisabled = null;
    try { newDisabled = clip.disabled; } catch (e) { newDisabled = null; }
    entry.verified = newDisabled === requestedDisabled;

    if (entry.verified) {
      verifiedCount++;
    }
    affected++;
    budget.remaining--;
    results.push(entry);
  }

  return { affected: affected, verifiedCount: verifiedCount };
}

function ppb_batchSetClipsEnabled(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.enabled !== "boolean") {
      return JSON.stringify({ ok: false, error: "enabled must be a boolean" });
    }
    var trackTypeFilter = args.trackType || "both";
    if (trackTypeFilter !== "video" && trackTypeFilter !== "audio" && trackTypeFilter !== "both") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\", \"audio\", or \"both\"" });
    }
    var nameContainsLower = null;
    if (typeof args.nameContains === "string" && args.nameContains.length > 0) {
      nameContainsLower = args.nameContains.toLowerCase();
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

    var results = [];
    var budget = { remaining: BATCH_SET_CLIPS_ENABLED_MAX, cappedAtLimit: false };
    var totalAffected = 0;
    var totalVerified = 0;

    if (trackTypeFilter === "video" || trackTypeFilter === "both") {
      for (var vt = 0; vt < seq.videoTracks.numTracks; vt++) {
        var vRes = ppb_batchSetClipsEnabledOnTrack(seq.videoTracks[vt], "video", vt, nameContainsLower, args.enabled, budget, results);
        totalAffected += vRes.affected;
        totalVerified += vRes.verifiedCount;
        if (budget.cappedAtLimit) { break; }
      }
    }
    if (!budget.cappedAtLimit && (trackTypeFilter === "audio" || trackTypeFilter === "both")) {
      for (var at = 0; at < seq.audioTracks.numTracks; at++) {
        var aRes = ppb_batchSetClipsEnabledOnTrack(seq.audioTracks[at], "audio", at, nameContainsLower, args.enabled, budget, results);
        totalAffected += aRes.affected;
        totalVerified += aRes.verifiedCount;
        if (budget.cappedAtLimit) { break; }
      }
    }

    var result = {
      sequenceName: seq.name,
      trackType: trackTypeFilter,
      nameContains: args.nameContains || null,
      requestedEnabled: args.enabled,
      affected: totalAffected,
      verifiedCount: totalVerified,
      cappedAtLimit: budget.cappedAtLimit,
      results: results
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
