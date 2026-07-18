// Command: get-insertion-bin → ppb_getInsertionBin
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Thin read of app.project.getInsertionBin() — the bin currently focused
// in the Project panel, i.e. where a new import would land.

function ppb_getInsertionBin(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var bin = null;
    try {
      bin = app.project.getInsertionBin();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getInsertionBin failed: " + e.toString() });
    }

    if (!bin) {
      return JSON.stringify({ ok: false, error: "no insertion bin found" });
    }

    var result = { name: null, nodeId: null, treePath: null };
    try { result.name = bin.name; } catch (e) { result.name = null; }
    try { result.nodeId = bin.nodeId; } catch (e) { result.nodeId = null; }
    try { result.treePath = bin.treePath; } catch (e) { result.treePath = null; }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
