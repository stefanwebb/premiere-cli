// Command: import-mogrt → ppb_importMogrt
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — findSequenceByName,
// secondsToTicksString, timeValueToSeconds are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp text.ts import_mogrt.
// Imports a .mogrt file directly onto the timeline via
// seq.importMGT(mogrtPath, startTicksString, videoTrackIndex,
// audioTrackIndex).
//
// ⚠️ RETURN-VALUE DISCREPANCY: text.ts treats importMGT()'s return value
// as a boolean ("if (!success) return __error(...)"), but
// PREMIERE_API_NOTES.md documents it as returning a trackItem object
// ("seq.importMGT(...) → trackItem"). Both are handled defensively here —
// the raw return value's type is reported, and if it looks like a
// trackItem (a non-null object with a readable .name), that's surfaced
// too — but the PRIMARY verification is independent of either claim: the
// target video track's own clip count before/after, same MUTATION RULE
// every other placement command in this panel follows (add-to-timeline,
// duplicate-clip, ...) rather than trusting an ambiguous return value.
function ppb_importMogrt(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.mogrtPath !== "string" || !args.mogrtPath) {
      return JSON.stringify({ ok: false, error: "mogrtPath is required" });
    }
    if (typeof args.startSeconds !== "number") {
      return JSON.stringify({ ok: false, error: "startSeconds is required" });
    }
    if (typeof args.videoTrackIndex !== "number") {
      return JSON.stringify({ ok: false, error: "videoTrackIndex is required" });
    }
    if (typeof args.audioTrackIndex !== "number") {
      return JSON.stringify({ ok: false, error: "audioTrackIndex is required" });
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

    var numVideoTracks;
    try { numVideoTracks = seq.videoTracks.numTracks; } catch (e2) { numVideoTracks = 0; }
    if (args.videoTrackIndex >= numVideoTracks) {
      return JSON.stringify({ ok: false, error: "videoTrackIndex " + args.videoTrackIndex + " is out of range — sequence has " + numVideoTracks + " video track(s)" });
    }
    var videoTrack = seq.videoTracks[args.videoTrackIndex];
    var trackClipCountBefore = null;
    try { trackClipCountBefore = videoTrack.clips.numItems; } catch (e3) { trackClipCountBefore = null; }

    var startTicks = secondsToTicksString(args.startSeconds);
    var importResult = null;
    try {
      importResult = seq.importMGT(args.mogrtPath, startTicks, args.videoTrackIndex, args.audioTrackIndex);
    } catch (e4) {
      return JSON.stringify({ ok: false, error: "seq.importMGT() failed: " + e4.toString() });
    }

    var trackClipCountAfter = null;
    try { trackClipCountAfter = videoTrack.clips.numItems; } catch (e5) { trackClipCountAfter = null; }

    var placed = trackClipCountBefore !== null && trackClipCountAfter !== null && trackClipCountAfter > trackClipCountBefore;

    var returnValueType = typeof importResult;
    var returnValueIsObject = importResult !== null && typeof importResult === "object";
    var returnValueName = null;
    if (returnValueIsObject) {
      try { returnValueName = importResult.name; } catch (e6) { returnValueName = null; }
    }
    var returnValueTruthy = !!importResult;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        mogrtPath: args.mogrtPath,
        startSeconds: args.startSeconds,
        videoTrackIndex: args.videoTrackIndex,
        audioTrackIndex: args.audioTrackIndex,
        trackClipCountBefore: trackClipCountBefore,
        trackClipCountAfter: trackClipCountAfter,
        placed: placed,
        verified: placed,
        importReturnValueType: returnValueType,
        importReturnValueTruthy: returnValueTruthy,
        importReturnValueName: returnValueName,
        note: "verified via the target video track's clip count, not importMGT()'s own return value — text.ts treats that return as a boolean while PREMIERE_API_NOTES.md documents it as a trackItem; both are reported above but neither is trusted for verification."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
