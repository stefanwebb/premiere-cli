// Command: get-qe-clip-info → ppb_getQeClipInfo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, ...) are already defined there.
//
// QE DOM read — undocumented, version-dependent surface (see
// PREMIERE_API_NOTES.md). QE items expose `.secs` on their time-like
// properties, NOT `.seconds` like the standard DOM (ayushozha's finding,
// confirmed in our notes) — qeTimeToSeconds below handles that. QE DOM
// operates on qe.project.getActiveSequence() only, so this command
// activates the resolved sequence first, same as remove-track-intervals.
// Clip addressing (trackType/trackIndex/clipIndex) is validated against
// the standard DOM's track/clip counts first — same range-check pattern
// as get-full-clip-info — since the QE track/clip API surfaces no count
// validation of its own. Ported from leancoderkavy's premiere-pro-mcp
// `get_qe_clip_info` tool (track-targeting.ts).

var GET_QE_CLIP_INFO_PROPS = [
  "name", "type", "mediaType", "duration", "start", "end", "inPoint", "outPoint",
  "speed", "audioChannelType", "numAudioChannels"
];

function qeTimeToSeconds(timeLike) {
  if (timeLike === null || typeof timeLike === "undefined") {
    return null;
  }
  if (typeof timeLike === "number") {
    return timeLike;
  }
  if (typeof timeLike.secs === "number") {
    return timeLike.secs;
  }
  if (typeof timeLike.seconds === "number") {
    return timeLike.seconds;
  }
  if (typeof timeLike.ticks !== "undefined") {
    return Number(timeLike.ticks) / TICKS_PER_SECOND;
  }
  return null;
}

function ppb_getQeClipInfo(argsJson) {
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
    var numClips = trackCollection[args.trackIndex].clips.numItems;
    if (args.clipIndex >= numClips) {
      return JSON.stringify({
        ok: false,
        error: "clipIndex " + args.clipIndex + " is out of range — track " + args.trackIndex + " has " + numClips + " clip(s)"
      });
    }

    // QE DOM only ever operates on the active sequence tab — switch to it
    // rather than erroring if the resolved sequence isn't already active.
    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
    }

    try {
      ensureQEEnabled();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var qeSeq;
    try {
      qeSeq = qe.project.getActiveSequence();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() failed: " + e.toString() });
    }
    if (!qeSeq) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() returned nothing after activating the sequence" });
    }

    var qeTrack;
    try {
      qeTrack = args.trackType === "video" ? qeSeq.getVideoTrackAt(args.trackIndex) : qeSeq.getAudioTrackAt(args.trackIndex);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "QE track lookup failed: " + e.toString() });
    }
    if (!qeTrack) {
      return JSON.stringify({ ok: false, error: "QE track not found at index " + args.trackIndex });
    }

    var qeClip;
    try {
      qeClip = qeTrack.getItemAt(args.clipIndex);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "QE clip lookup failed: " + e.toString() });
    }
    if (!qeClip) {
      return JSON.stringify({ ok: false, error: "QE clip not found at index " + args.clipIndex });
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex
    };

    var TIME_FIELDS = { duration: true, start: true, end: true, inPoint: true, outPoint: true };

    for (var i = 0; i < GET_QE_CLIP_INFO_PROPS.length; i++) {
      var propName = GET_QE_CLIP_INFO_PROPS[i];
      try {
        var raw = qeClip[propName];
        if (TIME_FIELDS[propName]) {
          result[propName + "Seconds"] = qeTimeToSeconds(raw);
        } else {
          result[propName] = raw;
        }
      } catch (e) {
        // leave this field absent — best-effort per PPB_COMMANDS convention
      }
    }

    var availableProperties = [];
    try {
      for (var key in qeClip) {
        try {
          if (typeof qeClip[key] !== "function") {
            availableProperties.push(key);
          }
        } catch (e) {
          // some QE keys throw on access — skip
        }
      }
    } catch (e) {
      // for-in itself failed — leave list empty
    }
    result.availableProperties = availableProperties;

    var availableMethods = [];
    try {
      for (var mkey in qeClip) {
        try {
          if (typeof qeClip[mkey] === "function") {
            availableMethods.push(mkey);
          }
        } catch (e) {
          // some QE keys throw on access — skip
        }
      }
    } catch (e) {
      // for-in itself failed — leave list empty
    }
    result.availableMethods = availableMethods;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
