// Command: get-version-info → ppb_getVersionInfo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's track-targeting.ts
// get_version_info. App-level — no project or sequence involved. Every
// field is individually best-effort (null if unreadable), matching the
// reference's per-field try/catch.
function ppb_getVersionInfo(argsJson) {
  try {
    var version = null;
    var buildNumber = null;
    var isDocumentOpen = null;
    var path = null;

    try { version = app.version; } catch (e) { version = null; }
    try { buildNumber = app.build; } catch (e) { buildNumber = null; }
    try { isDocumentOpen = app.isDocumentOpen(); } catch (e) { isDocumentOpen = null; }
    try { path = app.path; } catch (e) { path = null; }

    return JSON.stringify({
      ok: true,
      result: {
        version: version,
        buildNumber: buildNumber,
        isDocumentOpen: isDocumentOpen,
        path: path
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
