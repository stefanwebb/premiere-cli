// Command: list-available-audio-transitions → ppb_listAvailableAudioTransitions
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// QE-only enumeration: qe.project.getAudioTransitionList(). An empty list
// is returned as-is (ok: true, count: 0) — truthful, not an error — since
// the video-transition sibling command has a known-empty-list quirk on
// PPro 2026 and audio transitions haven't been confirmed either way.

function ppb_listAvailableAudioTransitions(argsJson) {
  try {
    ensureQEEnabled();

    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available (app.enableQE() did not expose qe.project)" });
    }

    var transitions = [];
    try {
      var list = qe.project.getAudioTransitionList();
      for (var i = 0; i < list.numItems; i++) {
        var entry = { name: null, index: i };
        try { entry.name = list[i].name; } catch (e) { entry.name = null; }
        transitions.push(entry);
      }
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getAudioTransitionList() failed: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { transitions: transitions, count: transitions.length } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
