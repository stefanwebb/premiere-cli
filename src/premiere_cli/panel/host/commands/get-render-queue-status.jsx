// Command: get-render-queue-status → ppb_getRenderQueueStatus
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Standard DOM only (app.encoder), no QE needed. Per PREMIERE_API_NOTES.md
// ("No progress API — fire and forget"), Adobe Media Encoder exposes no
// real queue-introspection API from ExtendScript — this surfaces whatever
// `app.encoder.isRunning()` reports (if the method exists on this
// Premiere build) rather than inventing queue detail that doesn't exist.

function ppb_getRenderQueueStatus(argsJson) {
  try {
    if (typeof app.encoder === "undefined" || !app.encoder) {
      return JSON.stringify({ ok: false, error: "Adobe Media Encoder is not available (app.encoder is undefined)" });
    }

    var isRunning = null;
    try {
      if (typeof app.encoder.isRunning === "function") {
        isRunning = app.encoder.isRunning();
      }
    } catch (e) {
      isRunning = null;
    }

    var result = {
      isRunning: isRunning,
      info: "Premiere's ExtendScript API has no render-queue introspection — check Adobe Media Encoder itself for detailed job/progress status."
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
