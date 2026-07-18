// Command: add-custom-metadata-field → ppb_addCustomMetadataField
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts
// add_custom_metadata_field. Calls app.project.
// addPropertyToProjectMetadataSchema(name, label, type) per
// PREMIERE_API_NOTES.md's Markers/metadata/misc section. `type` is a raw
// int enum per the reference tool: 0 = Integer, 1 = Real, 2 = String,
// 3 = Boolean.
//
// NOTE (per this task's brief): this is PROJECT-WIDE schema mutation, not
// a per-item field — it adds a new column to every item's metadata in
// this project, and is NOT removable from script (no
// removePropertyFromProjectMetadataSchema-equivalent exists in any
// reference repo studied). There is no reliable read-back API for the
// metadata schema itself (get-project-panel-metadata reads the Project
// panel's column *display* configuration, not the schema), so
// verification here is call-level only (the call didn't throw) —
// documented honestly rather than a fabricated "verified" flag.

function ppb_addCustomMetadataField(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.name || typeof args.name !== "string") {
      return JSON.stringify({ ok: false, error: "name is required" });
    }
    var label = (typeof args.label === "string" && args.label.length > 0) ? args.label : args.name;
    var type = typeof args.type === "number" ? args.type : 2; // default: String

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    if (typeof app.project.addPropertyToProjectMetadataSchema !== "function") {
      return JSON.stringify({ ok: false, error: "addPropertyToProjectMetadataSchema is not available on this Premiere build" });
    }

    try {
      app.project.addPropertyToProjectMetadataSchema(args.name, label, type);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "addPropertyToProjectMetadataSchema() failed: " + e.toString() });
    }

    return JSON.stringify({
      ok: true,
      result: {
        added: true,
        name: args.name,
        label: label,
        type: type,
        note: "project-wide metadata schema change — this field is added to every item's metadata in this project and cannot be removed from script (no reference repo we studied has a removal API); verification here is call-level only, no read-back API exists for the schema itself"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
