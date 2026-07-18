// Command: remove-effect → ppb_removeEffect
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeClipComponents,
// isProtectedBuiltinComponent, ...) are already defined there.
//
// Removes one component from a clip by its index into clip.components.
// comp.remove() is DISPUTED across the reference repos this panel ports
// from — one claims single-effect removal works, another claims it's
// impossible — so success here is judged ONLY by clip.components.numItems
// actually dropping by 1 afterward, never by whether remove() itself threw.
// Refuses outright to touch Motion/Opacity (see isProtectedBuiltinComponent)
// since undo is non-functional on this build and removing an intrinsic
// component has no path back. Given that, this command is the primary
// cleanup path for apply-effect/apply-audio-effect mistakes — it must be
// solid and honest about what actually happened.
function ppb_removeEffect(argsJson) {
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
    if (typeof args.clipIndex !== "number" || args.clipIndex < 0 || Math.floor(args.clipIndex) !== args.clipIndex) {
      return JSON.stringify({ ok: false, error: "clipIndex must be a non-negative integer" });
    }
    if (typeof args.componentIndex !== "number" || args.componentIndex < 0 || Math.floor(args.componentIndex) !== args.componentIndex) {
      return JSON.stringify({ ok: false, error: "componentIndex must be a non-negative integer" });
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

    var resolvedClip = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    if (resolvedClip.error) {
      return JSON.stringify({ ok: false, error: resolvedClip.error });
    }
    var clip = resolvedClip.clip;
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var previousComponents = serializeClipComponents(clip);
    var previousCount = previousComponents.length;

    if (args.componentIndex >= previousCount) {
      return JSON.stringify({
        ok: false,
        error: "componentIndex " + args.componentIndex + " is out of range — clip has " + previousCount + " component(s)"
      });
    }

    var targetComponent = clip.components[args.componentIndex];
    if (isProtectedBuiltinComponent(targetComponent)) {
      return JSON.stringify({
        ok: false,
        error: "refusing to remove a built-in component (Motion/Opacity) at componentIndex " + args.componentIndex + " — undo is non-functional on this build, so there is no path back"
      });
    }

    var targetInfo = previousComponents[args.componentIndex];

    var attempts = [];
    try {
      targetComponent.remove();
      attempts.push({ call: "component.remove()", success: true });
    } catch (e) {
      attempts.push({ call: "component.remove()", success: false, error: e.toString() });
    }

    var newComponents = serializeClipComponents(clip);
    var newCount = newComponents.length;
    var verified = newCount === previousCount - 1;

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName,
      componentIndex: args.componentIndex,
      removedComponent: targetInfo,
      verified: verified,
      previousComponentCount: previousCount,
      newComponentCount: newCount,
      previousComponents: previousComponents,
      newComponents: newComponents,
      attempts: attempts
    };
    if (!verified) {
      // Live-confirmed 2026-07-17: component.remove() silently no-ops on
      // this Premiere 2026 build.
      result.note = "single-effect removal is NON-FUNCTIONAL on this Premiere build — component.remove() no-throws but removes nothing (live-confirmed). Try remove-all-effects (QE removeEffects strips SOME effects), or remove manually in Effect Controls.";
      return JSON.stringify({ ok: false, error: "the component was not actually removed (component.remove() is a silent no-op on this build)", result: result });
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
