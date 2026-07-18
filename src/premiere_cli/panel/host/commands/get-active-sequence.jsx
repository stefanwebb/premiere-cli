// Command: get-active-sequence → ppb_getActiveSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// serializeTrackItem, ...) are already defined there.
//
// Standard-DOM read only (seq.videoTracks[i].clips[j]) — no QE DOM needed,
// no need to activate the sequence tab.

function ppb_serializeTrack(track, trackIndex) {
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
      out.clips.push(serializeTrackItem(track.clips[c], trackIndex, c));
    }
  } catch (e) {
    // leave clipCount/clips as-is (null / whatever was collected so far)
  }

  return out;
}

function ppb_getActiveSequence(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ ok: false, error: "no active sequence" });
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
        videoTracks.push(ppb_serializeTrack(seq.videoTracks[v], v));
      }
    } catch (e) {
      // leave videoTracks as whatever was collected so far
    }

    var audioTracks = [];
    try {
      for (var a = 0; a < seq.audioTracks.numTracks; a++) {
        audioTracks.push(ppb_serializeTrack(seq.audioTracks[a], a));
      }
    } catch (e) {
      // leave audioTracks as whatever was collected so far
    }

    var result = {
      name: seq.name,
      sequenceID: seq.sequenceID,
      frameRate: frameRate,
      durationSeconds: durationSeconds,
      width: width,
      height: height,
      videoTracks: videoTracks,
      audioTracks: audioTracks
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
