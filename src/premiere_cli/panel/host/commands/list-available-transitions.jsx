// Command: list-available-transitions → ppb_listAvailableTransitions
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// QE-only enumeration: qe.project.getVideoTransitionList(), which returns a
// plain array of STRINGS. Reading it as a collection of objects (numItems /
// entry.name) is what made this look empty and produced
// PREMIERE_API_NOTES.md's "PPro 2026 returns an EMPTY list" note — measured
// 2026-07-24, it holds 110 entries. See ppbTransitionNamesFrom in index.jsx.
// The by-name probe below is kept as a fallback (source: "byName") for a
// build where the list genuinely is empty.

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
      var names = ppbTransitionNamesFrom(qe.project.getVideoTransitionList());
      for (var i = 0; i < names.length; i++) {
        transitions.push({ name: names[i], index: i, source: "list" });
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
