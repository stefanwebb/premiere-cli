// Command: get-used-media-report → ppb_getUsedMediaReport
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, ...) are already defined there.
//
// Standard-DOM read only, no QE DOM needed. Scans every clip on every
// video/audio track of the resolved sequence, grouping by source
// projectItem.nodeId. Helper names are prefixed ppbUsedMediaReport_ to
// avoid colliding with same-purpose helpers in other lazily-loaded command
// files evaluated into this same global context.

function ppbUsedMediaReport_scanTracks(tracks, trackTypeLabel, mediaMap, order) {
  for (var t = 0; t < tracks.numTracks; t++) {
    var track = tracks[t];
    var numClips = 0;
    try {
      numClips = track.clips.numItems;
    } catch (e) {
      numClips = 0;
    }

    for (var c = 0; c < numClips; c++) {
      var clip = track.clips[c];
      var src = null;
      try {
        src = clip.projectItem;
      } catch (e) {
        src = null;
      }
      if (!src) {
        continue;
      }

      var key = null;
      try {
        key = src.nodeId;
      } catch (e) {
        key = null;
      }
      if (!key) {
        continue;
      }

      if (!mediaMap[key]) {
        var entry = { nodeId: key, name: null, mediaPath: null, offline: null, useCount: 0, tracksSet: {} };
        try { entry.name = src.name; } catch (e) { entry.name = null; }
        try { entry.mediaPath = src.getMediaPath(); } catch (e) { entry.mediaPath = null; }
        try { entry.offline = src.isOffline(); } catch (e) { entry.offline = null; }
        mediaMap[key] = entry;
        order.push(key);
      }

      mediaMap[key].useCount++;
      mediaMap[key].tracksSet[trackTypeLabel + t] = true;
    }
  }
}

function ppb_getUsedMediaReport(argsJson) {
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

    var mediaMap = {};
    var order = [];
    ppbUsedMediaReport_scanTracks(seq.videoTracks, "V", mediaMap, order);
    ppbUsedMediaReport_scanTracks(seq.audioTracks, "A", mediaMap, order);

    var media = [];
    var offlineUsedCount = 0;
    for (var i = 0; i < order.length; i++) {
      var entry = mediaMap[order[i]];
      var trackList = [];
      for (var k in entry.tracksSet) {
        if (entry.tracksSet.hasOwnProperty(k)) {
          trackList.push(k);
        }
      }
      if (entry.offline === true) {
        offlineUsedCount++;
      }
      media.push({
        nodeId: entry.nodeId,
        name: entry.name,
        mediaPath: entry.mediaPath,
        offline: entry.offline,
        useCount: entry.useCount,
        tracks: trackList
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        uniqueMediaCount: media.length,
        offlineUsedCount: offlineUsedCount,
        media: media
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
