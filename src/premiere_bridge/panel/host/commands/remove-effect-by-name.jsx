// Command: remove-effect-by-name → ppb_removeEffectByName
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// resolveTimelineClip, serializeClipComponents,
// isProtectedBuiltinComponent, ...) are already defined there.
//
// Removes EVERY component on a clip whose displayName OR matchName exactly
// matches effectName (leancoderkavy's clipboard.ts remove_effect_by_name
// removes all matches too, not just the first). Iterates components
// backwards so removing one doesn't shift the indices of ones still to be
// checked. Motion/Opacity are still refused even if effectName happens to
// match them — see remove-effect's notes on why. Same disputed-API
// verification as remove-effect: judged by clip.components.numItems
// dropping, not by remove()'s return value.
function ppb_removeEffectByName(argsJson) {
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

    var resolvedClip = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    if (resolvedClip.error) {
      return JSON.stringify({ ok: false, error: resolvedClip.error });
    }
    var clip = resolvedClip.clip;
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var previousComponents = serializeClipComponents(clip);
    var previousCount = previousComponents.length;

    var matchingIndices = [];
    for (var i = 0; i < previousCount; i++) {
      var info = previousComponents[i];
      if (info.displayName === args.effectName || info.matchName === args.effectName) {
        matchingIndices.push(i);
      }
    }

    if (matchingIndices.length === 0) {
      return JSON.stringify({ ok: false, error: "no component found on this clip matching displayName/matchName \"" + args.effectName + "\"" });
    }

    var attempts = [];
    var removedCount = 0;
    var skippedProtected = 0;
    // Iterate backwards so an earlier removal never shifts a later index
    // still queued for removal.
    for (var m = matchingIndices.length - 1; m >= 0; m--) {
      var idx = matchingIndices[m];
      var comp = clip.components[idx];
      if (isProtectedBuiltinComponent(comp)) {
        skippedProtected++;
        attempts.push({ componentIndex: idx, success: false, skipped: true, reason: "protected built-in component (Motion/Opacity)" });
        continue;
      }
      try {
        comp.remove();
        attempts.push({ componentIndex: idx, success: true });
        removedCount++;
      } catch (e) {
        attempts.push({ componentIndex: idx, success: false, error: e.toString() });
      }
    }

    var newComponents = serializeClipComponents(clip);
    var newCount = newComponents.length;
    var actualDropped = previousCount - newCount;
    var verified = actualDropped === removedCount;

    if (matchingIndices.length === skippedProtected) {
      return JSON.stringify({
        ok: false,
        error: "every component matching \"" + args.effectName + "\" is a protected built-in (Motion/Opacity) — refusing to remove"
      });
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName,
      effectName: args.effectName,
      matchedCount: matchingIndices.length,
      removeCallsSucceeded: removedCount,
      skippedProtected: skippedProtected,
      verified: verified,
      previousComponentCount: previousCount,
      newComponentCount: newCount,
      previousComponents: previousComponents,
      newComponents: newComponents,
      attempts: attempts
    };
    if (actualDropped === 0) {
      // Live-confirmed 2026-07-17: component.remove() silently no-ops on
      // this Premiere 2026 build — treat a zero drop as a hard failure,
      // never a success.
      result.note = "single-effect removal is NON-FUNCTIONAL on this Premiere build — component.remove() no-throws but removes nothing (live-confirmed). Try remove-all-effects (QE removeEffects strips SOME effects), or remove manually in Effect Controls.";
      return JSON.stringify({ ok: false, error: "no components were actually removed (component.remove() is a silent no-op on this build)", result: result });
    }
    if (!verified) {
      result.note = "components.numItems dropped, but not by the expected amount — partial removal.";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
