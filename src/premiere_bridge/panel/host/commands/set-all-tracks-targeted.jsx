// Command: set-all-tracks-targeted → ppb_setAllTracksTargeted
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `set_all_tracks_targeted` tool (track-targeting.ts): loops every track
// (optionally filtered to one trackType) and calls setTargeted(targeted,
// isVideoBool). Verified with a per-track isTargeted() read-back summary
// rather than trusting the mutation calls' own (lack of) return values.
function ppb_setAllTracksTargeted(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.targeted !== "boolean") {
      return JSON.stringify({ ok: false, error: "targeted must be a boolean" });
    }

    var trackType = args.trackType || "both";
    if (trackType !== "video" && trackType !== "audio" && trackType !== "both") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\", \"audio\", or \"both\"" });
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

    var video = [];
    var audio = [];
    var affected = 0;

    if (trackType !== "audio") {
      for (var v = 0; v < seq.videoTracks.numTracks; v++) {
        var vTrack = seq.videoTracks[v];
        var vEntry = { index: v, name: null, requested: args.targeted, isTargeted: null, error: null };
        try { vEntry.name = vTrack.name; } catch (e) { vEntry.name = null; }
        try {
          vTrack.setTargeted(args.targeted, true);
          affected++;
        } catch (e) {
          vEntry.error = e.toString();
        }
        try { vEntry.isTargeted = vTrack.isTargeted(); } catch (e) { vEntry.isTargeted = null; }
        video.push(vEntry);
      }
    }

    if (trackType !== "video") {
      for (var a = 0; a < seq.audioTracks.numTracks; a++) {
        var aTrack = seq.audioTracks[a];
        var aEntry = { index: a, name: null, requested: args.targeted, isTargeted: null, error: null };
        try { aEntry.name = aTrack.name; } catch (e) { aEntry.name = null; }
        try {
          aTrack.setTargeted(args.targeted, false);
          affected++;
        } catch (e) {
          aEntry.error = e.toString();
        }
        try { aEntry.isTargeted = aTrack.isTargeted(); } catch (e) { aEntry.isTargeted = null; }
        audio.push(aEntry);
      }
    }

    var mismatches = [];
    var i;
    for (i = 0; i < video.length; i++) {
      if (video[i].isTargeted !== null && video[i].isTargeted !== args.targeted) {
        mismatches.push("video[" + video[i].index + "]");
      }
    }
    for (i = 0; i < audio.length; i++) {
      if (audio[i].isTargeted !== null && audio[i].isTargeted !== args.targeted) {
        mismatches.push("audio[" + audio[i].index + "]");
      }
    }

    var result = {
      sequenceName: seq.name,
      trackType: trackType,
      requestedTargeted: args.targeted,
      tracksAffected: affected,
      video: video,
      audio: audio
    };

    if (mismatches.length > 0) {
      result.warning = "the following tracks did not read back the requested targeted state: " + mismatches.join(", ");
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
