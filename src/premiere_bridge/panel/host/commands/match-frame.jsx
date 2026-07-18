// Command: match-frame → ppb_matchFrame
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// TICKS_PER_SECOND, timeValueToSeconds, ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's utility.ts match_frame.
// Finds the clip covering `seconds` (or the sequence's own playhead if
// omitted) on video track 0 by default, computes the equivalent SOURCE
// time within that clip's media (offset = timelinePosition - clip.start +
// clip.inPoint, per the reference's own formula), then attempts to load
// that source into the Source Monitor via
// `app.sourceMonitor.openProjectItem(item)` (documented in
// PREMIERE_API_NOTES.md's "Source monitor 3-point editing" line) — this
// is the part the reference tool itself never actually does (its handler
// only computes and returns the numbers); this command goes one step
// further and attempts the real "load the source frame into the source
// monitor" behavior implied by the command's name.
//
// No confirmed API exists to seek the Source Monitor to an exact offset
// after opening a clip (only .play(speed)/.getPosition()/.closeClip() are
// documented) — openProjectItem() itself is reported as
// sourceMonitorOpened; the offset is reported for the caller to act on
// (e.g. scrub manually, or once a seek API is confirmed).
function ppb_matchFrame(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
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

    var trackType = args.trackType === "audio" ? "audio" : "video";
    var trackIndex = typeof args.trackIndex === "number" ? args.trackIndex : 0;
    var tracks = trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var numTracks = 0;
    try { numTracks = tracks.numTracks; } catch (e) { numTracks = 0; }
    if (trackIndex >= numTracks) {
      return JSON.stringify({ ok: false, error: "trackIndex " + trackIndex + " is out of range — sequence has " + numTracks + " " + trackType + " track(s)" });
    }

    var atSeconds;
    if (typeof args.seconds === "number" && !isNaN(args.seconds)) {
      atSeconds = args.seconds;
    } else {
      try {
        atSeconds = seq.getPlayerPosition().seconds;
      } catch (e) {
        return JSON.stringify({ ok: false, error: "seconds was omitted and the playhead position could not be read: " + e.toString() });
      }
    }
    var posTicks = atSeconds * TICKS_PER_SECOND;

    var track = tracks[trackIndex];
    var found = null;
    var numClips = 0;
    try { numClips = track.clips.numItems; } catch (e) { numClips = 0; }
    for (var c = 0; c < numClips; c++) {
      var clip = track.clips[c];
      var startTicks = null;
      var endTicks = null;
      try { startTicks = Number(clip.start.ticks); } catch (e) { startTicks = null; }
      try { endTicks = Number(clip.end.ticks); } catch (e) { endTicks = null; }
      if (startTicks !== null && endTicks !== null && startTicks <= posTicks && endTicks > posTicks) {
        found = clip;
        break;
      }
    }

    if (!found) {
      return JSON.stringify({ ok: false, error: "no clip at " + atSeconds + "s on " + trackType + " track " + trackIndex });
    }

    var clipName = null;
    var clipNodeId = null;
    try { clipName = found.name; } catch (e) { clipName = null; }
    try { clipNodeId = found.nodeId; } catch (e) { clipNodeId = null; }

    var offsetTicks = null;
    try {
      offsetTicks = posTicks - Number(found.start.ticks) + Number(found.inPoint.ticks);
    } catch (e) {
      offsetTicks = null;
    }

    var result = {
      sequenceName: seq.name,
      trackType: trackType,
      trackIndex: trackIndex,
      timelineSeconds: atSeconds,
      clipName: clipName,
      clipNodeId: clipNodeId,
      sourceSeconds: offsetTicks !== null ? (offsetTicks / TICKS_PER_SECOND) : null,
      sourceItem: null,
      sourceMediaPath: null,
      sourceMonitorOpened: false,
      sourceMonitorError: null
    };

    var src = null;
    try { src = found.projectItem; } catch (e) { src = null; }
    if (src) {
      try { result.sourceItem = { name: src.name, nodeId: src.nodeId }; } catch (e) { result.sourceItem = null; }
      try { result.sourceMediaPath = src.getMediaPath(); } catch (e) { result.sourceMediaPath = null; }

      try {
        if (app.sourceMonitor && typeof app.sourceMonitor.openProjectItem === "function") {
          app.sourceMonitor.openProjectItem(src);
          result.sourceMonitorOpened = true;
        } else {
          result.sourceMonitorError = "app.sourceMonitor.openProjectItem is not available on this build";
        }
      } catch (e) {
        result.sourceMonitorError = e.toString();
      }
    } else {
      result.sourceMonitorError = "clip has no projectItem (source) to open";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
