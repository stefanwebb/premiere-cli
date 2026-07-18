// Command: get-sequence-count → ppb_getSequenceCount
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use.
//
// Standard-DOM read only, no args. Ported from leancoderkavy's
// premiere-pro-mcp `get_sequence_count` tool (utility.ts).

function ppb_getSequenceCount() {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var count = null;
    try {
      count = app.project.sequences.numSequences;
    } catch (e) {
      return JSON.stringify({ ok: false, error: "could not read sequence count: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { count: count } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
