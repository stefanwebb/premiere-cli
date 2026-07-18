// Command: get-target-tracks → ppb_getTargetTracks
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Standard-DOM read only — no QE DOM needed, no need to activate the
// sequence tab. Ported from leancoderkavy's premiere-pro-mcp
// `get_target_tracks` tool (track-targeting.ts), which only reads the
// active sequence; here `sequenceName` may target any open sequence.

function ppb_getTargetTracks(argsJson) {
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

    var video = [];
    try {
      for (var v = 0; v < seq.videoTracks.numTracks; v++) {
        var vTrack = seq.videoTracks[v];
        try {
          if (vTrack.isTargeted()) {
            video.push({ index: v, name: vTrack.name });
          }
        } catch (e) {
          // skip tracks whose isTargeted() throws
        }
      }
    } catch (e) {
      // leave video as whatever was collected so far
    }

    var audio = [];
    try {
      for (var a = 0; a < seq.audioTracks.numTracks; a++) {
        var aTrack = seq.audioTracks[a];
        try {
          if (aTrack.isTargeted()) {
            audio.push({ index: a, name: aTrack.name });
          }
        } catch (e) {
          // skip tracks whose isTargeted() throws
        }
      }
    } catch (e) {
      // leave audio as whatever was collected so far
    }

    return JSON.stringify({
      ok: true,
      result: { sequenceName: seq.name, video: video, audio: audio }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
