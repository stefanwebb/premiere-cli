// Command: list-available-audio-effects → ppb_listAvailableAudioEffects
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// QE-only enumeration: qe.project.getAudioEffectList(). Read-only, no
// sequence/project-item addressing needed.

function ppb_listAvailableAudioEffects(argsJson) {
  try {
    ensureQEEnabled();

    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available (app.enableQE() did not expose qe.project)" });
    }

    var effects = [];
    try {
      var list = qe.project.getAudioEffectList();
      for (var i = 0; i < list.numItems; i++) {
        var entry = { name: null, index: i };
        try { entry.name = list[i].name; } catch (e) { entry.name = null; }
        effects.push(entry);
      }
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getAudioEffectList() failed: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { effects: effects, count: effects.length } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
