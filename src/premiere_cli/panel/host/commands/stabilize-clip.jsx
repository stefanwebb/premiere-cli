// Command: stabilize-clip → ppb_stabilizeClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, serializeClipComponents, findQeVideoEffectByName,
// findClipComponent, setComponentProperty, ...) are already defined there.
//
// Applies Warp Stabilizer via the standard QE dance (getVideoEffectByName +
// addVideoEffect), verified by clip.components.numItems increasing by 1,
// then optionally sets "Smoothness" (number) and/or "Method" (string enum —
// "Subspace Warp"/"Position"/"Position, Scale, Rotation" per the reference
// tool) via the shared setComponentProperty helper. Warp Stabilizer analysis
// itself runs asynchronously inside Premiere after being applied — this
// command does not wait for or report analysis completion.
function ppb_stabilizeClip(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.trackType !== "video") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" — Warp Stabilizer is a video effect" });
    }
    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.clipIndex !== "number" || args.clipIndex < 0 || Math.floor(args.clipIndex) !== args.clipIndex) {
      return JSON.stringify({ ok: false, error: "clipIndex must be a non-negative integer" });
    }
    if (args.smoothness !== undefined && typeof args.smoothness !== "number") {
      return JSON.stringify({ ok: false, error: "smoothness must be a number if given" });
    }
    if (args.method !== undefined && typeof args.method !== "string") {
      return JSON.stringify({ ok: false, error: "method must be a string if given" });
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

    var fx = findQeVideoEffectByName("Warp Stabilizer");
    if (!fx) {
      return JSON.stringify({ ok: false, error: "Warp Stabilizer effect not found in this Premiere install's QE effect catalog" });
    }

    try {
      qeResolved.qeClip.addVideoEffect(fx);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qeClip.addVideoEffect(Warp Stabilizer) failed: " + e.toString() });
    }

    var newComponents = serializeClipComponents(clip);
    var componentVerified = newComponents.length === previousComponents.length + 1;

    var changes = {};
    if (componentVerified) {
      var warpComp = findClipComponent(clip, null, ["Warp Stabilizer"]);
      if (warpComp) {
        if (typeof args.smoothness === "number") {
          var smoothResult = setComponentProperty(warpComp, ["Smoothness"], args.smoothness);
          changes.smoothness = smoothResult.found ? smoothResult : { found: false };
        }
        if (typeof args.method === "string") {
          var methodResult = setComponentProperty(warpComp, ["Method"], args.method);
          changes.method = methodResult.found ? methodResult : { found: false };
        }
      } else if (typeof args.smoothness === "number" || typeof args.method === "string") {
        changes.error = "Warp Stabilizer was applied but could not be re-found on the standard-DOM clip to set properties";
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: "video",
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: clipName,
        verified: componentVerified,
        changes: changes,
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
