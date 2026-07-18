// Command: apply-effect → ppb_applyEffect
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, serializeClipComponents, findQeVideoEffectByName, ...) are
// already defined there.
//
// Applies a video effect to a clip via the "universal dance" documented in
// PREMIERE_API_NOTES.md's "Effects, transitions, keyframes" section:
// look up the effect in the QE catalog (getVideoEffectByName, falling back
// to a getVideoEffectList() scan), call qeClip.addVideoEffect(fx), then read
// the standard-DOM clip.components back — the new component is appended
// LAST. Mutation is verified by clip.components.numItems increasing by
// exactly 1, not by trusting addVideoEffect()'s return value (undocumented
// on this build, like every other QE mutation call here).
function ppb_applyEffect(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.trackType !== "video") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" — apply-effect applies a VIDEO effect (use apply-audio-effect for audio clips)" });
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

    var resolvedClip = resolveTimelineClip(seq, "video", args.trackIndex, args.clipIndex);
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

    var qeResolved = resolveQeClip(qeSeq, "video", args.trackIndex, args.clipIndex);
    if (qeResolved.error) {
      return JSON.stringify({ ok: false, error: qeResolved.error });
    }

    var fx = findQeVideoEffectByName(args.effectName);
    if (!fx) {
      return JSON.stringify({ ok: false, error: "video effect not found in this Premiere install's QE effect catalog: \"" + args.effectName + "\"" });
    }

    try {
      qeResolved.qeClip.addVideoEffect(fx);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qeClip.addVideoEffect() failed: " + e.toString() });
    }

    var newComponents = serializeClipComponents(clip);
    var verified = newComponents.length === previousComponents.length + 1;
    var newComponent = verified ? newComponents[newComponents.length - 1] : null;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: "video",
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
