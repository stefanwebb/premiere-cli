// Command: get-clip-markers → ppb_getClipMarkers
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Clip addressing matches get-full-clip-info.jsx (sequenceName?,
// trackType, trackIndex, clipIndex) — the reference tool this is ported
// from (leancoderkavy's get_clip_markers) addresses a PROJECT item by
// item_id, but per our own convention every other clip-scoped command
// addresses a TIMELINE clip the same way get-full-clip-info does, so this
// reads clip.markers (a TrackItem's own marker collection — same API
// shape as seq.markers per PREMIERE_API_NOTES.md) rather than a project
// item's getMarkers().

function ppbGetClipMarkers_serialize(clip, sourceOut) {
  var markers = [];
  // clip.markers (a TrackItem's own marker collection) is undefined on
  // this Premiere 2026 build (live-tested 2026-07-17: "undefined is not
  // an object") — fall back to the clip's source project item's
  // getMarkers(). Semantics differ slightly (source-item markers vs
  // timeline-clip markers); result reports which source answered.
  var collection = null;
  try {
    if (clip.markers && typeof clip.markers.getFirstMarker === "function") {
      collection = clip.markers;
      sourceOut.source = "trackItem";
    }
  } catch (e) {
    // fall through
  }
  if (collection === null) {
    try {
      var itemMarkers = clip.projectItem.getMarkers();
      if (itemMarkers && typeof itemMarkers.getFirstMarker === "function") {
        collection = itemMarkers;
        sourceOut.source = "projectItem";
      }
    } catch (e) {
      // fall through
    }
  }
  if (collection === null) {
    throw new Error("neither clip.markers nor clip.projectItem.getMarkers() is available on this build");
  }

  var m = collection.getFirstMarker();
  var iterations = 0;
  while (m !== null && typeof m !== "undefined" && iterations < 10000) {
    var entry = { name: null, comments: null, type: null, startSeconds: null, endSeconds: null, guid: null };
    try { entry.name = m.name; } catch (e) { entry.name = null; }
    try { entry.comments = m.comments; } catch (e) { entry.comments = null; }
    try { entry.type = m.type; } catch (e) { entry.type = null; }
    try { entry.startSeconds = timeValueToSeconds(m.start); } catch (e) { entry.startSeconds = null; }
    try { entry.endSeconds = timeValueToSeconds(m.end); } catch (e) { entry.endSeconds = null; }
    try { entry.guid = m.guid; } catch (e) { entry.guid = null; }
    markers.push(entry);

    m = collection.getNextMarker(m);
    iterations++;
  }
  return markers;
}

function ppb_getClipMarkers(argsJson) {
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

    var markers = [];
    try {
      var markerSource = { source: null };
      markers = ppbGetClipMarkers_serialize(clip, markerSource);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "failed to read clip markers: " + e.toString() });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        clipName: (function () { try { return clip.name; } catch (e) { return null; } })(),
        markers: markers,
        markerCount: markers.length,
        markerSource: markerSource.source
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
