// Command: set-project-panel-metadata → ppb_setProjectPanelMetadata
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Write-side counterpart of the existing get-project-panel-metadata.jsx
// (which reads app.project.getProjectPanelMetadata() as an XML string).
// Ported from leancoderkavy/premiere-pro-mcp's project.ts
// set_project_panel_metadata: app.project.setProjectPanelMetadata(xml)
// REPLACES the Project panel's entire column/metadata configuration —
// not a merge/patch, same caveat as this repo's existing
// set-xmp-metadata.jsx for item-level XMP. previousValue/newValue are
// read via getProjectPanelMetadata() before/after; `verified` is a
// straightforward string comparison of newValue against the requested
// XML. Undo is NON-FUNCTIONAL on this build — previousValue is the only
// restoration path.

function ppb_setProjectPanelMetadata(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.metadata !== "string" || args.metadata.length === 0) {
      return JSON.stringify({ ok: false, error: "metadata (XML string) is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    if (typeof app.project.setProjectPanelMetadata !== "function") {
      return JSON.stringify({ ok: false, error: "setProjectPanelMetadata is not available on this Premiere build" });
    }

    var previousValue = null;
    if (typeof app.project.getProjectPanelMetadata === "function") {
      try { previousValue = app.project.getProjectPanelMetadata(); } catch (e) { previousValue = null; }
    }

    try {
      app.project.setProjectPanelMetadata(args.metadata);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setProjectPanelMetadata() failed: " + e.toString() });
    }

    var newValue = null;
    if (typeof app.project.getProjectPanelMetadata === "function") {
      try { newValue = app.project.getProjectPanelMetadata(); } catch (e) { newValue = null; }
    }

    var verified = typeof newValue === "string" && newValue === args.metadata;

    return JSON.stringify({
      ok: true,
      result: {
        set: true,
        requestedValue: args.metadata,
        previousValue: previousValue,
        newValue: newValue,
        verified: verified,
        note: "REPLACES the entire Project panel column/metadata configuration — not a merge; get-project-panel-metadata first and modify. Undo is NON-FUNCTIONAL on this build — previousValue is the only restoration path."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
