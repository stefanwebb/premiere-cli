// Command: rename-clip → ppb_renameClip
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, ...) are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp `rename_clip` tool
// (advanced.ts), which renames exclusively via the QE DOM (`qeClip.
// setName()`). PREMIERE_API_NOTES.md's Clips section says standard-DOM
// `clip.name = x` is also cited as working [hetpatel] — probed FIRST here
// since it needs no QE activation/tab-switch; falls back to the QE
// setName() path only if the standard-DOM assignment doesn't stick. Either
// way, the result is read back from clip.name afterward, never trusted
// from either mutation call's own success.
function ppb_renameClip(argsJson) {
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
    if (typeof args.name !== "string" || args.name.length === 0) {
      return JSON.stringify({ ok: false, error: "name must be a non-empty string" });
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
    var oldName = null;
    try { oldName = clip.name; } catch (e) { oldName = null; }

    var method = null;
    var standardDomError = null;
    try {
      clip.name = args.name;
      method = "standardDom";
    } catch (e) {
      standardDomError = e.toString();
    }

    var newName = null;
    try { newName = clip.name; } catch (e) { newName = null; }

    var qeError = null;
    if (newName !== args.name) {
      try {
        ensureQEEnabled();
        activateSequenceForQE(seq);
        var qeSeq = qe.project.getActiveSequence();
        var qeTrack = args.trackType === "video" ? qeSeq.getVideoTrackAt(args.trackIndex) : qeSeq.getAudioTrackAt(args.trackIndex);
        var qeClip = qeFindNthNonEmptyClip(qeTrack, args.clipIndex);
        if (!qeClip) {
          qeError = "could not locate the corresponding QE clip";
        } else {
          qeClip.setName(args.name);
          method = "qe";
        }
      } catch (e) {
        qeError = e.toString();
      }
      try { newName = clip.name; } catch (e) { newName = newName; }
    }

    var verified = newName === args.name;

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      previousValue: oldName,
      requestedValue: args.name,
      newValue: newName,
      verified: verified,
      method: method,
      standardDomError: standardDomError,
      qeError: qeError
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
