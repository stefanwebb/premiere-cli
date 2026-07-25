// Command: list-available-audio-transitions → ppb_listAvailableAudioTransitions
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// QE-only enumeration: qe.project.getAudioTransitionList(), which returns a
// plain array of STRINGS. Reading it as a collection of objects (numItems /
// entry.name) is what made this report zero — see ppbTransitionNamesFrom in
// index.jsx. Measured 2026-07-24: 3 entries ("Constant Power",
// "Constant Gain", "Exponential Fade").

function ppb_listAvailableAudioTransitions(argsJson) {
  try {
    ensureQEEnabled();

    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available (app.enableQE() did not expose qe.project)" });
    }

    var transitions = [];
    try {
      var names = ppbTransitionNamesFrom(qe.project.getAudioTransitionList());
      for (var i = 0; i < names.length; i++) {
        transitions.push({ name: names[i], index: i });
      }
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getAudioTransitionList() failed: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { transitions: transitions, count: transitions.length } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
