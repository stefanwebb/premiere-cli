// Command: get-mogrt-component → ppb_getMogrtComponent
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — findSequenceByName,
// resolveTimelineClip are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp advanced.ts
// get_mogrt_component, re-addressed to this panel's
// trackType/trackIndex/clipIndex convention (same as get-full-clip-info)
// instead of node_id. READ-ONLY — properties are serialized the same
// shape as get-effect-properties ({displayName, value, isTimeVarying,
// keyCount}).
//
// ⚠️ Per PREMIERE_API_NOTES.md's "MOGRT Source Text format" note, a
// MOGRT's Source Text property value is a 4-byte binary header + JSON
// (mTextParam structure) — plain getValue() returns that raw blob, not
// human-readable text. This command does NOT attempt to strip the header
// or parse the JSON (that's a write-path concern per the reference
// project's hard-won notes, and this command never writes) — the raw
// value is reported as-is; callers wanting the actual displayed text need
// to decode it client-side.
function ppb_getMogrtComponent(argsJson) {
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
    if (typeof args.trackIndex !== "number" || typeof args.clipIndex !== "number") {
      return JSON.stringify({ ok: false, error: "trackIndex and clipIndex are required" });
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

    var resolved = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    if (resolved.error) {
      return JSON.stringify({ ok: false, error: resolved.error });
    }
    var clip = resolved.clip;
    var clipName = null;
    try { clipName = clip.name; } catch (e2) { clipName = null; }

    var mgtComp = null;
    try {
      mgtComp = clip.getMGTComponent();
    } catch (e3) {
      return JSON.stringify({ ok: false, error: "clip.getMGTComponent() failed: " + e3.toString() });
    }
    if (!mgtComp) {
      return JSON.stringify({ ok: false, error: "not a MOGRT clip, or no MGT component found on this clip" });
    }

    var numProps = 0;
    try { numProps = mgtComp.properties.numItems; } catch (e4) { numProps = 0; }

    var properties = [];
    for (var p = 0; p < numProps; p++) {
      var prop = mgtComp.properties[p];
      var info = { displayName: null, value: null, isTimeVarying: null, keyCount: null };
      try { info.displayName = prop.displayName; } catch (e5) { info.displayName = null; }
      try { info.value = prop.getValue(); } catch (e6) { info.value = null; }
      try { info.isTimeVarying = prop.isTimeVarying(); } catch (e7) { info.isTimeVarying = null; }
      try {
        if (info.isTimeVarying) {
          var keys = prop.getKeys();
          info.keyCount = keys ? keys.length : 0;
        } else {
          info.keyCount = 0;
        }
      } catch (e8) {
        info.keyCount = null;
      }
      properties.push(info);
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: clipName,
        properties: properties,
        propertyCount: properties.length,
        note: "values are raw getValue() output — a MOGRT's Source Text property is a 4-byte-header+JSON binary blob on this build per PREMIERE_API_NOTES.md, not decoded here (read-only command)."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
