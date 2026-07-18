// Command: stop-playback → ppb_stopPlayback
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's playback.ts stop_playback.
// QE DOM only (qe.stopPlayback()) — inherently active-sequence-only, same
// as play-timeline: no sequenceName override.
function ppb_stopPlayback(argsJson) {
  try {
    ensureQEEnabled();

    try {
      qe.stopPlayback();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not stop playback: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { stopped: true } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
