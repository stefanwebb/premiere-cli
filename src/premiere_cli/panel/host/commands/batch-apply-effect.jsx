// Command: batch-apply-effect → ppb_batchApplyEffect
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveQeClip,
// serializeClipComponents, findQeVideoEffectByName,
// findQeAudioEffectByName, ...) are already defined there.
//
// Ports leancoderkavy's clipboard.ts batch_apply_effect's "track"/"all"
// targets (there is no "selected" target here — combine with
// select-clips-by-name/nameContains instead, same pattern
// batch-set-clips-enabled uses). Matches clips across the given track
// type(s) (default "both"), optionally narrowed to one trackIndex and/or a
// case-insensitive nameContains substring, capped at 100 clips per call.
// Each matching clip gets the effect applied via the standard QE dance
// (getVideoEffectByName/getAudioEffectByName + addVideoEffect/
// addAudioEffect chosen by THAT clip's own track type, not a single global
// effect object — a video effect and an audio effect with the same name are
// different catalog entries), verified individually by that clip's own
// clip.components.numItems increasing by 1.
function ppb_batchApplyEffect(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.effectName !== "string" || !args.effectName) {
      return JSON.stringify({ ok: false, error: "effectName must be a non-empty string" });
    }
    var trackTypeFilter = args.trackType || "both";
    if (trackTypeFilter !== "video" && trackTypeFilter !== "audio" && trackTypeFilter !== "both") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\", \"audio\", or \"both\"" });
    }
    if (args.trackIndex !== undefined && args.trackIndex !== null) {
      if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
        return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer if given" });
      }
      if (trackTypeFilter === "both") {
        return JSON.stringify({ ok: false, error: "trackIndex requires trackType to be \"video\" or \"audio\" (not \"both\")" });
      }
    }
    var nameContains = (typeof args.nameContains === "string" && args.nameContains) ? args.nameContains.toLowerCase() : null;

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

    // Collect every matching clip's standard-DOM addressing BEFORE any QE
    // mutation — mutating one clip never shifts another's trackIndex/
    // clipIndex, but we still want a stable, fully-enumerated list up front.
    var matches = [];
    function collectFrom(trackCollection, trackTypeName) {
      var numTracks = trackCollection.numTracks;
      for (var t = 0; t < numTracks; t++) {
        if (args.trackIndex !== undefined && args.trackIndex !== null && t !== args.trackIndex) {
          continue;
        }
        var track = trackCollection[t];
        var numClips = track.clips.numItems;
        for (var c = 0; c < numClips; c++) {
          var clip = track.clips[c];
          var name = null;
          try { name = clip.name; } catch (e) { name = null; }
          if (nameContains && (!name || name.toLowerCase().indexOf(nameContains) === -1)) {
            continue;
          }
          matches.push({ trackType: trackTypeName, trackIndex: t, clipIndex: c, clipName: name, clip: clip });
        }
      }
    }
    if (trackTypeFilter === "video" || trackTypeFilter === "both") {
      collectFrom(seq.videoTracks, "video");
    }
    if (trackTypeFilter === "audio" || trackTypeFilter === "both") {
      collectFrom(seq.audioTracks, "audio");
    }

    var totalMatched = matches.length;
    var cappedAtLimit = totalMatched > 100;
    if (cappedAtLimit) {
      matches = matches.slice(0, 100);
    }

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

    var results = [];
    var appliedCount = 0;

    for (var m = 0; m < matches.length; m++) {
      var match = matches[m];
      var previousCount = 0;
      try { previousCount = match.clip.components.numItems; } catch (e) { previousCount = 0; }

      var qeResolved = resolveQeClip(qeSeq, match.trackType, match.trackIndex, match.clipIndex);
      if (qeResolved.error) {
        results.push({ trackType: match.trackType, trackIndex: match.trackIndex, clipIndex: match.clipIndex, clipName: match.clipName, applied: false, error: qeResolved.error });
        continue;
      }

      var fx = match.trackType === "video" ? findQeVideoEffectByName(args.effectName) : findQeAudioEffectByName(args.effectName);
      if (!fx) {
        results.push({ trackType: match.trackType, trackIndex: match.trackIndex, clipIndex: match.clipIndex, clipName: match.clipName, applied: false, error: "effect not found in this track type's QE catalog: \"" + args.effectName + "\"" });
        continue;
      }

      try {
        if (match.trackType === "video") {
          qeResolved.qeClip.addVideoEffect(fx);
        } else {
          qeResolved.qeClip.addAudioEffect(fx);
        }
      } catch (e2) {
        results.push({ trackType: match.trackType, trackIndex: match.trackIndex, clipIndex: match.clipIndex, clipName: match.clipName, applied: false, error: "addVideoEffect/addAudioEffect failed: " + e2.toString() });
        continue;
      }

      var newCount = 0;
      try { newCount = match.clip.components.numItems; } catch (e3) { newCount = 0; }
      var verified = newCount === previousCount + 1;
      if (verified) {
        appliedCount++;
      }

      results.push({
        trackType: match.trackType,
        trackIndex: match.trackIndex,
        clipIndex: match.clipIndex,
        clipName: match.clipName,
        applied: true,
        verified: verified,
        previousComponentCount: previousCount,
        newComponentCount: newCount
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        effectName: args.effectName,
        trackType: trackTypeFilter,
        nameContains: args.nameContains || null,
        totalMatched: totalMatched,
        cappedAtLimit: cappedAtLimit,
        appliedCount: appliedCount,
        results: results
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
