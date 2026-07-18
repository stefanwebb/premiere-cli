// Command: play-source-monitor → ppb_playSourceMonitor
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's playback.ts
// play_source_monitor. Standard DOM (app.sourceMonitor.play(speed)) — no
// QE, no sequence involved (operates on whatever clip is currently open
// in the Source Monitor).
function ppb_playSourceMonitor(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var speed = 1.0;
    if (args.speed !== undefined && args.speed !== null) {
      if (typeof args.speed !== "number" || isNaN(args.speed)) {
        return JSON.stringify({ ok: false, error: "speed must be a number" });
      }
      speed = args.speed;
    }

    try {
      app.sourceMonitor.play(speed);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not play source monitor: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { playing: true, speed: speed } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
