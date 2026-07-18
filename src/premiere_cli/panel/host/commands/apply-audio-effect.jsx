// Command: apply-audio-effect → ppb_applyAudioEffect
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, serializeClipComponents, findQeAudioEffectByName, ...) are
// already defined there.
//
// Audio counterpart of apply-effect: qe.project.getAudioEffectByName() (or a
// getAudioEffectList() scan fallback) + qeClip.addAudioEffect(fx). Same
// verification approach — clip.components.numItems increasing by exactly 1,
// never trusting addAudioEffect()'s own return value.
function ppb_applyAudioEffect(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.trackType !== "audio") {
      return JSON.stringify({ ok: false, error: "trackType must be \"audio\" — apply-audio-effect applies an AUDIO effect (use apply-effect for video clips)" });
    }
    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.clipIndex !== "number" || args.clipIndex < 0 || Math.floor(args.clipIndex) !== args.clipIndex) {
      return JSON.stringify({ ok: false, error: "clipIndex must be a non-negative integer" });
    }
    if (typeof args.effectName !== "string" || !args.effectName) {
      return JSON.stringify({ ok: false, error: "effectName must be a non-empty string" });
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

    var resolvedClip = resolveTimelineClip(seq, "audio", args.trackIndex, args.clipIndex);
    if (resolvedClip.error) {
      return JSON.stringify({ ok: false, error: resolvedClip.error });
    }
    var clip = resolvedClip.clip;
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var previousComponents = serializeClipComponents(clip);

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

    var qeResolved = resolveQeClip(qeSeq, "audio", args.trackIndex, args.clipIndex);
    if (qeResolved.error) {
      return JSON.stringify({ ok: false, error: qeResolved.error });
    }

    var fx = findQeAudioEffectByName(args.effectName);
    if (!fx) {
      return JSON.stringify({ ok: false, error: "audio effect not found in this Premiere install's QE effect catalog: \"" + args.effectName + "\"" });
    }

    try {
      qeResolved.qeClip.addAudioEffect(fx);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qeClip.addAudioEffect() failed: " + e.toString() });
    }

    var newComponents = serializeClipComponents(clip);
    var verified = newComponents.length === previousComponents.length + 1;
    var newComponent = verified ? newComponents[newComponents.length - 1] : null;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: "audio",
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: clipName,
        effectName: args.effectName,
        verified: verified,
        newComponent: newComponent,
        previousComponentCount: previousComponents.length,
        newComponentCount: newComponents.length,
        previousComponents: previousComponents,
        newComponents: newComponents
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
