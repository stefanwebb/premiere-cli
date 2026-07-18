// Command: get-total-clip-count → ppb_getTotalClipCount
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Standard-DOM read only — no QE DOM needed, no need to activate the
// sequence tab. Ported from leancoderkavy's premiere-pro-mcp
// `get_total_clip_count` tool (utility.ts), which only reads the active
// sequence; here `sequenceName` may target any open sequence.

function ppb_getTotalClipCount(argsJson) {
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

    var videoClips = 0;
    try {
      for (var v = 0; v < seq.videoTracks.numTracks; v++) {
        videoClips += seq.videoTracks[v].clips.numItems;
      }
    } catch (e) {
      // leave videoClips as whatever was collected so far
    }

    var audioClips = 0;
    try {
      for (var a = 0; a < seq.audioTracks.numTracks; a++) {
        audioClips += seq.audioTracks[a].clips.numItems;
      }
    } catch (e) {
      // leave audioClips as whatever was collected so far
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        videoClips: videoClips,
        audioClips: audioClips,
        total: videoClips + audioClips
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
