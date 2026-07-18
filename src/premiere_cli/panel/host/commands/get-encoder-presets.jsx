// Command: get-encoder-presets → ppb_getEncoderPresets
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use.
//
// PREMIERE_API_NOTES.md flags `app.encoder.getExporters()` →
// `.getPresets()` as an unconfirmed API surface ([ayushozha] uses it, the
// other two repos scan .epr files on disk instead). We probe the live-API
// route only (no filesystem scanning) with a try/catch around every single
// field access, so an unsupported build reports an honest
// {"available": false} rather than throwing or guessing preset paths.
// Ported (loosely) from leancoderkavy's premiere-pro-mcp
// `get_encoder_presets` tool (track-targeting.ts), which instead walks
// .epr files on disk — not attempted here, see the note above.

function ppb_getEncoderPresets(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var result = { available: false, presets: [], count: 0 };

    var encoder = null;
    try {
      encoder = app.encoder;
    } catch (e) {
      encoder = null;
    }
    if (!encoder) {
      result.error = "app.encoder is not available on this Premiere build";
      return JSON.stringify({ ok: true, result: result });
    }

    var exporters = null;
    try {
      exporters = encoder.getExporters();
    } catch (e) {
      result.error = "app.encoder.getExporters() failed: " + e.toString();
      return JSON.stringify({ ok: true, result: result });
    }
    if (!exporters) {
      result.error = "app.encoder.getExporters() returned nothing";
      return JSON.stringify({ ok: true, result: result });
    }

    var numExporters = 0;
    try {
      numExporters = typeof exporters.numItems === "number" ? exporters.numItems : exporters.length;
    } catch (e) {
      numExporters = 0;
    }
    if (typeof numExporters !== "number" || isNaN(numExporters)) {
      numExporters = 0;
    }

    result.available = true;
    result.exportersCount = numExporters;

    for (var i = 0; i < numExporters; i++) {
      var exporter = null;
      try {
        exporter = exporters[i];
      } catch (e) {
        continue;
      }
      if (!exporter) {
        continue;
      }

      var exporterName = null;
      try { exporterName = exporter.name; } catch (e) { exporterName = null; }

      var presetsForExporter = null;
      try {
        presetsForExporter = exporter.getPresets();
      } catch (e) {
        continue;
      }
      if (!presetsForExporter) {
        continue;
      }

      var numPresets = 0;
      try {
        numPresets = typeof presetsForExporter.numItems === "number" ? presetsForExporter.numItems : presetsForExporter.length;
      } catch (e) {
        numPresets = 0;
      }
      if (typeof numPresets !== "number" || isNaN(numPresets)) {
        numPresets = 0;
      }

      for (var p = 0; p < numPresets; p++) {
        var preset = null;
        try {
          preset = presetsForExporter[p];
        } catch (e) {
          continue;
        }
        if (!preset) {
          continue;
        }
        var entry = { exporterName: exporterName, name: null, path: null };
        try { entry.name = preset.name; } catch (e) { entry.name = null; }
        try { entry.path = preset.path; } catch (e) { entry.path = null; }
        result.presets.push(entry);
      }
    }

    if (args.format && typeof args.format === "string") {
      var needle = args.format.toLowerCase();
      var filtered = [];
      for (var f = 0; f < result.presets.length; f++) {
        var entryName = (result.presets[f].name || "").toLowerCase();
        var entryExporter = (result.presets[f].exporterName || "").toLowerCase();
        if (entryName.indexOf(needle) !== -1 || entryExporter.indexOf(needle) !== -1) {
          filtered.push(result.presets[f]);
        }
      }
      result.presets = filtered;
    }

    result.count = result.presets.length;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
