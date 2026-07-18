// Command: copy-effect-values → ppb_copyEffectValues
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, findClipComponent, valuesApproximatelyEqual, ...)
// are already defined there.
//
// Ports leancoderkavy's clipboard.ts copy_effect_values: the named effect
// must ALREADY be applied on BOTH clips (no QE apply step here, unlike
// copy-effects-between-clips) — only property VALUES are copied across via
// getValue()/setValue(), matched by displayName. Standard-DOM only, no QE
// needed, so source and target may be on different sequences with no
// active-sequence juggling.
function ppb_copyEffectValues(argsJson) {
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
    if (typeof args.effectName !== "string" || !args.effectName) {
      return JSON.stringify({ ok: false, error: "effectName must be a non-empty string" });
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

    var srcComp = findClipComponent(srcClip, null, [args.effectName]);
    if (!srcComp) {
      return JSON.stringify({ ok: false, error: "effect \"" + args.effectName + "\" not found on the source clip" });
    }
    var tgtComp = findClipComponent(tgtClip, null, [args.effectName]);
    if (!tgtComp) {
      return JSON.stringify({ ok: false, error: "effect \"" + args.effectName + "\" not found on the target clip" });
    }

    var numSrcProps = 0;
    try { numSrcProps = srcComp.properties.numItems; } catch (e) { numSrcProps = 0; }
    var numTgtProps = 0;
    try { numTgtProps = tgtComp.properties.numItems; } catch (e) { numTgtProps = 0; }

    var properties = [];
    var copiedCount = 0;

    for (var sp = 0; sp < numSrcProps; sp++) {
      var srcProp = srcComp.properties[sp];
      var spName = null;
      try { spName = srcProp.displayName; } catch (e2) { spName = null; }
      if (!spName) {
        continue;
      }

      var matchedTgtProp = null;
      for (var tp = 0; tp < numTgtProps; tp++) {
        var candidate = tgtComp.properties[tp];
        var tpName = null;
        try { tpName = candidate.displayName; } catch (e3) { tpName = null; }
        if (tpName === spName) {
          matchedTgtProp = candidate;
          break;
        }
      }
      if (!matchedTgtProp) {
        properties.push({ displayName: spName, copied: false, error: "no matching property on target clip's effect" });
        continue;
      }

      var previousValue = null;
      try { previousValue = matchedTgtProp.getValue(); } catch (e4) { previousValue = null; }
      var requestedValue = null;
      try { requestedValue = srcProp.getValue(); } catch (e5) { requestedValue = null; }

      var copied = false;
      var errorMsg = null;
      try {
        matchedTgtProp.setValue(requestedValue, true);
        copied = true;
      } catch (e6) {
        errorMsg = e6.toString();
      }

      var newValue = null;
      if (copied) {
        try { newValue = matchedTgtProp.getValue(); } catch (e7) { newValue = null; }
        copiedCount++;
      }

      properties.push({
        displayName: spName,
        previousValue: previousValue,
        requestedValue: requestedValue,
        newValue: newValue,
        copied: copied,
        verified: copied && valuesApproximatelyEqual(newValue, requestedValue),
        error: errorMsg
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        effectName: args.effectName,
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
        propertiesTotal: numSrcProps,
        propertiesCopied: copiedCount,
        properties: properties
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
