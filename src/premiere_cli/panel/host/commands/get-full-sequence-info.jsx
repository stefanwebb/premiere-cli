// Command: get-full-sequence-info → ppb_getFullSequenceInfo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, serializeTrackItem, ...) are already defined there.
//
// Standard-DOM read only (seq.videoTracks[i].clips[j]) — no QE DOM needed,
// no need to activate the sequence tab. This is a self-contained command
// file (each command file loads independently, so it cannot rely on
// helpers defined only in another command file) — its own clip/track
// serialization is defined locally, layering `components` on top of the
// shared serializeTrackItem() fields.

// Per PREMIERE_API_NOTES.md's component model: clip.components[0]=Motion,
// [1]=Opacity, [2+]=applied effects.
function ppb_serializeComponentsForFullSequenceInfo(clip) {
  var components = [];
  try {
    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      var entry = { displayName: null, matchName: null, enabled: null, numProperties: null };
      try { entry.displayName = comp.displayName; } catch (e) { entry.displayName = null; }
      try { entry.matchName = comp.matchName; } catch (e) { entry.matchName = null; }
      try { entry.enabled = comp.enabled; } catch (e) { entry.enabled = null; }
      try { entry.numProperties = comp.properties.numItems; } catch (e) { entry.numProperties = null; }
      components.push(entry);
    }
  } catch (e) {
    // leave components as whatever was collected so far
  }
  return components;
}

function ppb_serializeClipForFullSequenceInfo(clip, trackIndex, clipIndex) {
  var out = serializeTrackItem(clip, trackIndex, clipIndex);
  out.components = ppb_serializeComponentsForFullSequenceInfo(clip);
  return out;
}

function ppb_serializeTrackForFullSequenceInfo(track, trackIndex) {
  var out = {
    index: trackIndex,
    name: null,
    isMuted: null,
    isLocked: null,
    clipCount: null,
    clips: []
  };

  try { out.name = track.name; } catch (e) { out.name = null; }
  try { out.isMuted = track.isMuted(); } catch (e) { out.isMuted = null; }
  try { out.isLocked = track.isLocked(); } catch (e) { out.isLocked = null; }

  try {
    out.clipCount = track.clips.numItems;
    for (var c = 0; c < track.clips.numItems; c++) {
      out.clips.push(ppb_serializeClipForFullSequenceInfo(track.clips[c], trackIndex, c));
    }
  } catch (e) {
    // leave clipCount/clips as-is
  }

  return out;
}

// Markers have no reliable indexing (PREMIERE_API_NOTES.md) — iterate via
// getFirstMarker()/getNextMarker(m), capped to guard against a pathological
// linked-list (e.g. a cycle from a corrupt project).
function ppb_serializeSequenceMarkers(seq) {
  var markers = [];
  try {
    var m = seq.markers.getFirstMarker();
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

      m = seq.markers.getNextMarker(m);
      iterations++;
    }
  } catch (e) {
    // leave markers as whatever was collected so far
  }
  return markers;
}

function ppb_getFullSequenceInfo(argsJson) {
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

    var frameRate = null;
    try {
      frameRate = getSequenceFps(seq);
    } catch (e) {
      frameRate = null;
    }

    var durationSeconds = null;
    try {
      durationSeconds = (Number(seq.end) - Number(seq.zeroPoint)) / TICKS_PER_SECOND;
    } catch (e) {
      durationSeconds = null;
    }

    var width = null;
    var height = null;
    try {
      var settings = seq.getSettings();
      width = settings.videoFrameWidth;
      height = settings.videoFrameHeight;
    } catch (e) {
      // best-effort only
    }

    var videoTracks = [];
    try {
      for (var v = 0; v < seq.videoTracks.numTracks; v++) {
        videoTracks.push(ppb_serializeTrackForFullSequenceInfo(seq.videoTracks[v], v));
      }
    } catch (e) {
      // leave videoTracks as whatever was collected so far
    }

    var audioTracks = [];
    try {
      for (var a = 0; a < seq.audioTracks.numTracks; a++) {
        audioTracks.push(ppb_serializeTrackForFullSequenceInfo(seq.audioTracks[a], a));
      }
    } catch (e) {
      // leave audioTracks as whatever was collected so far
    }

    var markerCount = null;
    try {
      markerCount = seq.markers.numMarkers;
    } catch (e) {
      markerCount = null;
    }

    var result = {
      name: seq.name,
      sequenceID: seq.sequenceID,
      frameRate: frameRate,
      durationSeconds: durationSeconds,
      width: width,
      height: height,
      videoTracks: videoTracks,
      audioTracks: audioTracks,
      markers: ppb_serializeSequenceMarkers(seq),
      markerCount: markerCount
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
