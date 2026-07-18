// Command: copy-effects-between-clips → ppb_copyEffectsBetweenClips
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, serializeClipComponents, findQeVideoEffectByName,
// findQeAudioEffectByName, isIntrinsicComponentDisplayName, ...) are already
// defined there.
//
// Ports leancoderkavy's clipboard.ts copy_effects_between_clips: for each
// non-intrinsic component on the SOURCE clip (Motion/Opacity/Time
// Remapping/Volume/Channel Volume/Panner are skipped — see
// isIntrinsicComponentDisplayName — unless effectName narrows the copy to
// one specific effect), re-applies the same-named effect on the TARGET clip
// via the standard QE dance, then copies every matching property's value
// across via getValue()/setValue(). Source and target clips may be on
// DIFFERENT sequences — QE only ever operates on the ACTIVE sequence, so
// the TARGET's sequence is made active for the QE apply calls (the source
// is read via the standard DOM only, which needs no activation).
function ppb_copyEffectsBetweenClips(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.sourceTrackType !== "video" && args.sourceTrackType !== "audio") {
      return JSON.stringify({ ok: false, error: "sourceTrackType must be \"video\" or \"audio\"" });
    }
    if (args.targetTrackType !== "video" && args.targetTrackType !== "audio") {
      return JSON.stringify({ ok: false, error: "targetTrackType must be \"video\" or \"audio\"" });
    }
    var indexFields = ["sourceTrackIndex", "sourceClipIndex", "targetTrackIndex", "targetClipIndex"];
    for (var f = 0; f < indexFields.length; f++) {
      var v = args[indexFields[f]];
      if (typeof v !== "number" || v < 0 || Math.floor(v) !== v) {
        return JSON.stringify({ ok: false, error: indexFields[f] + " must be a non-negative integer" });
      }
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    function resolveSeq(name) {
      if (name && typeof name === "string") {
        var found = findSequenceByName(name);
        if (!found) {
          return { error: "no sequence named \"" + name + "\" is open" };
        }
        return { seq: found };
      }
      var active = app.project.activeSequence;
      if (!active) {
        return { error: "no active sequence, and no sequenceName given" };
      }
      return { seq: active };
    }

    var srcSeqResolved = resolveSeq(args.sourceSequenceName);
    if (srcSeqResolved.error) {
      return JSON.stringify({ ok: false, error: "source: " + srcSeqResolved.error });
    }
    var srcSeq = srcSeqResolved.seq;

    var tgtSeqResolved = resolveSeq(args.targetSequenceName);
    if (tgtSeqResolved.error) {
      return JSON.stringify({ ok: false, error: "target: " + tgtSeqResolved.error });
    }
    var tgtSeq = tgtSeqResolved.seq;

    var srcResolvedClip = resolveTimelineClip(srcSeq, args.sourceTrackType, args.sourceTrackIndex, args.sourceClipIndex);
    if (srcResolvedClip.error) {
      return JSON.stringify({ ok: false, error: "source: " + srcResolvedClip.error });
    }
    var srcClip = srcResolvedClip.clip;
    var srcClipName = null;
    try { srcClipName = srcClip.name; } catch (e) { srcClipName = null; }

    var tgtResolvedClip = resolveTimelineClip(tgtSeq, args.targetTrackType, args.targetTrackIndex, args.targetClipIndex);
    if (tgtResolvedClip.error) {
      return JSON.stringify({ ok: false, error: "target: " + tgtResolvedClip.error });
    }
    var tgtClip = tgtResolvedClip.clip;
    var tgtClipName = null;
    try { tgtClipName = tgtClip.name; } catch (e) { tgtClipName = null; }

    var previousTargetComponents = serializeClipComponents(tgtClip);

    try {
      ensureQEEnabled();
      activateSequenceForQE(tgtSeq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/target sequence activation failed: " + e.toString() });
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

    var tgtQeResolved = resolveQeClip(qeSeq, args.targetTrackType, args.targetTrackIndex, args.targetClipIndex);
    if (tgtQeResolved.error) {
      return JSON.stringify({ ok: false, error: "target: " + tgtQeResolved.error });
    }
    var tgtQeClip = tgtQeResolved.qeClip;

    var effectFilter = (typeof args.effectName === "string" && args.effectName) ? args.effectName : null;

    var numSrcComponents;
    try {
      numSrcComponents = srcClip.components.numItems;
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read source clip's components: " + e.toString() });
    }

    var effectResults = [];
    var appliedCount = 0;

    for (var i = 0; i < numSrcComponents; i++) {
      var comp = srcClip.components[i];
      var dn = null;
      try { dn = comp.displayName; } catch (e2) { dn = null; }
      if (!dn) {
        continue;
      }
      if (effectFilter) {
        if (dn !== effectFilter) {
          continue;
        }
      } else if (isIntrinsicComponentDisplayName(dn)) {
        continue;
      }

      var fx = args.targetTrackType === "video" ? findQeVideoEffectByName(dn) : findQeAudioEffectByName(dn);
      if (!fx) {
        effectResults.push({ effect: dn, applied: false, error: "effect not found in the target track type's QE catalog" });
        continue;
      }

      try {
        if (args.targetTrackType === "video") {
          tgtQeClip.addVideoEffect(fx);
        } else {
          tgtQeClip.addAudioEffect(fx);
        }
      } catch (e3) {
        effectResults.push({ effect: dn, applied: false, error: "addVideoEffect/addAudioEffect failed: " + e3.toString() });
        continue;
      }

      // Per PREMIERE_API_NOTES.md, the newly-applied component is appended
      // LAST on the standard-DOM clip.
      var tgtNumComponents;
      try {
        tgtNumComponents = tgtClip.components.numItems;
      } catch (e4) {
        effectResults.push({ effect: dn, applied: true, propertiesCopied: 0, propertiesTotal: 0, error: "applied, but could not re-read target clip's components to copy property values: " + e4.toString() });
        appliedCount++;
        continue;
      }
      var tgtComp = tgtClip.components[tgtNumComponents - 1];

      var numSrcProps = 0;
      try { numSrcProps = comp.properties.numItems; } catch (e5) { numSrcProps = 0; }
      var numTgtProps = 0;
      try { numTgtProps = tgtComp.properties.numItems; } catch (e6) { numTgtProps = 0; }

      var propertiesCopied = 0;
      for (var sp = 0; sp < numSrcProps; sp++) {
        var srcProp = comp.properties[sp];
        var spName = null;
        try { spName = srcProp.displayName; } catch (e7) { spName = null; }
        if (!spName) {
          continue;
        }
        for (var tp = 0; tp < numTgtProps; tp++) {
          var tgtProp = tgtComp.properties[tp];
          var tpName = null;
          try { tpName = tgtProp.displayName; } catch (e8) { tpName = null; }
          if (tpName === spName) {
            try {
              var val = srcProp.getValue();
              tgtProp.setValue(val, true);
              propertiesCopied++;
            } catch (e9) {
              // best-effort — one unsettable property must not abort the
              // whole effect's copy
            }
            break;
          }
        }
      }

      effectResults.push({ effect: dn, applied: true, propertiesCopied: propertiesCopied, propertiesTotal: numSrcProps });
      appliedCount++;
    }

    var newTargetComponents = serializeClipComponents(tgtClip);

    return JSON.stringify({
      ok: true,
      result: {
        source: {
          sequenceName: srcSeq.name,
          trackType: args.sourceTrackType,
          trackIndex: args.sourceTrackIndex,
          clipIndex: args.sourceClipIndex,
          clipName: srcClipName
        },
        target: {
          sequenceName: tgtSeq.name,
          trackType: args.targetTrackType,
          trackIndex: args.targetTrackIndex,
          clipIndex: args.targetClipIndex,
          clipName: tgtClipName
        },
        effectFilter: effectFilter,
        appliedCount: appliedCount,
        effects: effectResults,
        previousTargetComponents: previousTargetComponents,
        newTargetComponents: newTargetComponents
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
