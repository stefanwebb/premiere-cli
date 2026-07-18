// Command: import-mogrt-from-library → ppb_importMogrtFromLibrary
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — findSequenceByName,
// secondsToTicksString are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp text.ts
// import_mogrt_from_library, WITH ONE DELIBERATE CORRECTION: that
// reference tool calls seq.importMGTFromLibrary(mogrtName, startTicks,
// trackIndex, trackIndex) — omitting a library name entirely — but
// PREMIERE_API_NOTES.md documents the real signature as
// seq.importMGTFromLibrary(libName, mogrtName, ticks, v, a), five
// arguments with the library name first. The reference's own call would
// pass a mogrt name where the library name belongs, which reads like a
// bug in that repo rather than an intentional simplification — this port
// follows PREMIERE_API_NOTES.md's documented signature instead, adding a
// required libraryName argument the reference's own tool lacks.
//
// MUTATION RULE: same as import-mogrt — verified via the target video
// track's own clip count before/after, never the call's return value
// (same ambiguous-return-type caveat).
function ppb_importMogrtFromLibrary(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.libraryName !== "string" || !args.libraryName) {
      return JSON.stringify({ ok: false, error: "libraryName is required (PREMIERE_API_NOTES.md documents importMGTFromLibrary as (libName, mogrtName, ticks, v, a) — the reference tool this ports omits it, which this command does not follow)" });
    }
    if (typeof args.mogrtName !== "string" || !args.mogrtName) {
      return JSON.stringify({ ok: false, error: "mogrtName is required" });
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
      importResult = seq.importMGTFromLibrary(args.libraryName, args.mogrtName, startTicks, args.videoTrackIndex, args.audioTrackIndex);
    } catch (e4) {
      return JSON.stringify({ ok: false, error: "seq.importMGTFromLibrary() failed: " + e4.toString() });
    }

    var trackClipCountAfter = null;
    try { trackClipCountAfter = videoTrack.clips.numItems; } catch (e5) { trackClipCountAfter = null; }

    var placed = trackClipCountBefore !== null && trackClipCountAfter !== null && trackClipCountAfter > trackClipCountBefore;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        libraryName: args.libraryName,
        mogrtName: args.mogrtName,
        startSeconds: args.startSeconds,
        videoTrackIndex: args.videoTrackIndex,
        audioTrackIndex: args.audioTrackIndex,
        trackClipCountBefore: trackClipCountBefore,
        trackClipCountAfter: trackClipCountAfter,
        placed: placed,
        verified: placed,
        importReturnValueTruthy: !!importResult,
        note: "libraryName argument added per PREMIERE_API_NOTES.md's documented 5-arg signature — the ported reference tool's own call omits it (see file header comment)."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
