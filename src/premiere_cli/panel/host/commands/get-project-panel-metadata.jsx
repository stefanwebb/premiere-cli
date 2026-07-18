// Command: get-project-panel-metadata → ppb_getProjectPanelMetadata
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Thin read of app.project.getProjectPanelMetadata() — the Project panel's
// column/metadata configuration, returned as an XML string.

function ppb_getProjectPanelMetadata(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var metadata = null;
    try {
      metadata = app.project.getProjectPanelMetadata();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getProjectPanelMetadata failed: " + e.toString() });
    }

    if (!metadata) {
      return JSON.stringify({ ok: false, error: "could not retrieve project panel metadata" });
    }

    return JSON.stringify({ ok: true, result: { metadata: metadata } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
