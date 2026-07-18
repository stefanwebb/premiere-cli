// Command: play-timeline → ppb_playTimeline
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's playback.ts play_timeline.
// QE DOM only (qe.startPlayback()) — this is inherently active-sequence-
// only, there is no sequenceName override: the QE DOM always operates on
// whichever sequence tab is currently frontmost in Premiere.
function ppb_playTimeline(argsJson) {
  try {
    ensureQEEnabled();

    try {
      qe.startPlayback();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not start playback: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { playing: true } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
