// Command: set-transcode-on-ingest → ppb_setTranscodeOnIngest
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts
// set_transcode_on_ingest, which calls
// app.project.setEnableTranscodeOnIngest(0|1) — an API not mentioned
// anywhere in PREMIERE_API_NOTES.md (none of the three studied repos'
// other tools touch it either), so its presence on this Premiere build
// is genuinely unconfirmed. Probes for the method before calling and
// fails honestly if absent, rather than assuming it exists. No known
// getter exists to read the setting back (getEnableTranscodeOnIngest is
// not documented or referenced anywhere either) — probed defensively the
// same way, and if present is used for a best-effort read-back;
// otherwise verification is call-level only.

function ppb_setTranscodeOnIngest(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.enabled !== "boolean") {
      return JSON.stringify({ ok: false, error: "enabled (true or false) is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    if (typeof app.project.setEnableTranscodeOnIngest !== "function") {
      return JSON.stringify({
        ok: false,
        error: "setEnableTranscodeOnIngest is not available on this Premiere build — this API is unconfirmed outside the reference tool it was ported from"
      });
    }

    var hasGetter = typeof app.project.getEnableTranscodeOnIngest === "function";
    var before = null;
    if (hasGetter) {
      try { before = app.project.getEnableTranscodeOnIngest(); } catch (e) { before = null; }
    }

    try {
      app.project.setEnableTranscodeOnIngest(args.enabled ? 1 : 0);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setEnableTranscodeOnIngest() failed: " + e.toString() });
    }

    var after = null;
    if (hasGetter) {
      try { after = app.project.getEnableTranscodeOnIngest(); } catch (e) { after = null; }
    }

    var verified = null;
    var note = null;
    if (hasGetter && after !== null) {
      verified = !!after === args.enabled;
    } else {
      note = "no read-back getter is available/confirmed on this build — verification is call-level only (setEnableTranscodeOnIngest() did not throw)";
    }

    return JSON.stringify({
      ok: true,
      result: {
        set: true,
        transcodeOnIngest: args.enabled,
        previousValue: hasGetter ? before : null,
        verified: verified,
        note: note
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
