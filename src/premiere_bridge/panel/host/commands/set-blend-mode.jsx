// Command: set-blend-mode → ppb_setBlendMode
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findClipComponent, setComponentProperty, ...) are already defined there.
//
// Standard-DOM only — no QE needed. Ported from leancoderkavy's
// premiere-pro-mcp `set_blend_mode` tool (clipboard.ts), addressed here by
// trackType/trackIndex/clipIndex (same convention as get-full-clip-info)
// instead of node_id. Sets the Opacity component's Blend Mode property.
//
// **API UNCERTAIN**: per PREMIERE_API_NOTES.md, Blend Mode is an int enum
// (1=Normal...22 or 27=Luminosity — the reference repos disagree on the
// map size/order), and that mapping is version-dependent across Premiere
// builds. This command takes and returns the RAW integer only — it does
// NOT attempt a name→int mapping table of its own (unlike the reference
// tool, which hardcodes one) since we have no way to verify it against
// this Premiere build. Callers are responsible for picking the right int
// for their build; previousValue/newValue in the result are the only
// reliable calibration signal available. Mutating — undo is non-functional
// on this build, so previousValue is the caller's only restoration path.

function ppb_setBlendMode(argsJson) {
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
    if (typeof args.blendMode !== "number" || Math.floor(args.blendMode) !== args.blendMode) {
      return JSON.stringify({ ok: false, error: "blendMode must be an integer (Blend Mode enum value — version-dependent, see command header comment)" });
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

    var opacityComp = findClipComponent(clip, ["AE.ADBE Opacity"], ["Opacity"]);
    if (!opacityComp) {
      return JSON.stringify({ ok: false, error: "Opacity component not found on clip" });
    }

    var setResult = setComponentProperty(opacityComp, ["Blend Mode"], args.blendMode);
    if (!setResult.found) {
      return JSON.stringify({ ok: false, error: "Blend Mode property not found on the Opacity component" });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: clipName,
        previousValue: setResult.previousValue,
        requestedValue: setResult.requestedValue,
        newValue: setResult.newValue,
        verified: setResult.verified,
        note: "Blend Mode enum mapping is version-dependent across Premiere builds — this raw int is not name-mapped by this command."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
