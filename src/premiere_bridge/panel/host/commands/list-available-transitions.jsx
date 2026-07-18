// Command: list-available-transitions → ppb_listAvailableTransitions
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// QE-only enumeration: qe.project.getVideoTransitionList(). Per
// PREMIERE_API_NOTES.md, PPro 2026 is known to return an EMPTY list here
// even though by-name lookup (getVideoTransitionByName) still resolves
// real transitions — an empty result is surfaced honestly (source:
// "list") rather than treated as an error, and a probe of common
// transition names via getVideoTransitionByName is appended as a
// best-effort fallback (source: "byName") when the list came back empty.

var PPB_LIST_TRANSITIONS_PROBE_NAMES = [
  "Cross Dissolve", "Dip to Black", "Dip to White", "Film Dissolve",
  "Additive Dissolve", "Morph Cut", "Push", "Slide", "Wipe",
  "Iris Round", "Iris Box"
];

function ppb_listAvailableTransitions(argsJson) {
  try {
    ensureQEEnabled();

    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available (app.enableQE() did not expose qe.project)" });
    }

    var transitions = [];
    var listError = null;
    try {
      var list = qe.project.getVideoTransitionList();
      for (var i = 0; i < list.numItems; i++) {
        var entry = { name: null, index: i, source: "list" };
        try { entry.name = list[i].name; } catch (e) { entry.name = null; }
        transitions.push(entry);
      }
    } catch (e) {
      listError = e.toString();
    }

    var probedByName = false;
    if (transitions.length === 0) {
      try {
        if (qe.project.getVideoTransitionByName) {
          probedByName = true;
          for (var n = 0; n < PPB_LIST_TRANSITIONS_PROBE_NAMES.length; n++) {
            try {
              var found = qe.project.getVideoTransitionByName(PPB_LIST_TRANSITIONS_PROBE_NAMES[n]);
              if (found) {
                transitions.push({ name: PPB_LIST_TRANSITIONS_PROBE_NAMES[n], index: null, source: "byName" });
              }
            } catch (e2) {
              // this probe name isn't available on this build — skip it
            }
          }
        }
      } catch (e3) {
        // leave probedByName as-is
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        transitions: transitions,
        count: transitions.length,
        listError: listError,
        probedByName: probedByName
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
