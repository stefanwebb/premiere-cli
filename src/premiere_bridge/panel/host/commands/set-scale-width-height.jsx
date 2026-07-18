// Command: set-scale-width-height → ppb_setScaleWidthHeight
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, setComponentProperty, ...) are already defined there.
//
// Standard-DOM only — no QE needed. Ported from leancoderkavy's
// premiere-pro-mcp `set_scale_width_height` tool (track-targeting.ts),
// addressed here by trackType/trackIndex/clipIndex (same convention as
// get-full-clip-info) instead of node_id. Sets the Motion component's
// Scale Width and/or Scale Height properties independently — this ONLY
// takes effect while Uniform Scale is off. Unlike the reference tool
// (which silently force-disables Uniform Scale before writing), this
// command reads Uniform Scale first and fails with an informative error if
// it's on, so a caller never gets a silent no-op — see set-uniform-scale
// to turn it off first. Mutating — undo is non-functional on this build,
// so previousValue in the result is the caller's only restoration path.

function ppb_setScaleWidthHeight(argsJson) {
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
    var hasWidth = typeof args.scaleWidth === "number";
    var hasHeight = typeof args.scaleHeight === "number";
    if (!hasWidth && !hasHeight) {
      return JSON.stringify({ ok: false, error: "at least one of scaleWidth or scaleHeight is required" });
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
    if (args.clipIndex >= numClips) {
      return JSON.stringify({
        ok: false,
        error: "clipIndex " + args.clipIndex + " is out of range — track " + args.trackIndex + " has " + numClips + " clip(s)"
      });
    }

    var clip = track.clips[args.clipIndex];
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var motion = findClipComponent(clip, ["AE.ADBE Motion"], ["Motion"]);
    if (!motion) {
      return JSON.stringify({ ok: false, error: "Motion component not found on clip" });
    }

    var uniformScaleProp = findComponentProperty(motion, ["Uniform Scale"]);
    if (!uniformScaleProp) {
      return JSON.stringify({ ok: false, error: "Uniform Scale property not found on the Motion component — cannot verify it is safe to set Scale Width/Height independently" });
    }
    var uniformScaleValue = null;
    try { uniformScaleValue = uniformScaleProp.getValue(); } catch (e) { uniformScaleValue = null; }
    if (uniformScaleValue === true || uniformScaleValue === 1) {
      return JSON.stringify({
        ok: false,
        error: "Uniform Scale is currently ON — Scale Width/Scale Height cannot be set independently while it's on. Call set-uniform-scale with uniform:false first."
      });
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName
    };

    if (hasWidth) {
      var widthResult = setComponentProperty(motion, ["Scale Width"], args.scaleWidth);
      if (!widthResult.found) {
        return JSON.stringify({ ok: false, error: "Scale Width property not found on the Motion component" });
      }
      result.scaleWidth = {
        previousValue: widthResult.previousValue,
        requestedValue: widthResult.requestedValue,
        newValue: widthResult.newValue,
        verified: widthResult.verified
      };
    }

    if (hasHeight) {
      // Live-discovered 2026-07-17: the Motion component has NO "Scale
      // Height" property on this build — with Uniform Scale off, the plain
      // "Scale" property IS the height, and "Scale Width" is the width.
      var heightResult = setComponentProperty(motion, ["Scale", "Scale Height"], args.scaleHeight);
      if (!heightResult.found) {
        return JSON.stringify({ ok: false, error: "Scale (height) property not found on the Motion component" });
      }
      result.scaleHeight = {
        previousValue: heightResult.previousValue,
        requestedValue: heightResult.requestedValue,
        newValue: heightResult.newValue,
        verified: heightResult.verified
      };
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
