// Command: get-project-info → ppb_getProjectInfo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, findSequenceByName, ...) are already defined there.
//
// Unlike the multi-project get-open-projects.jsx (which lists every
// currently OPEN project), this operates on app.project — the single
// active project — and additionally reports the root bin's item count.

function ppb_getProjectInfo(argsJson) {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var proj = app.project;
    var sequences = [];

    for (var j = 0; j < proj.sequences.numSequences; j++) {
      var seq = proj.sequences[j];
      var frameRate = null;
      var durationSeconds = null;

      try {
        frameRate = TICKS_PER_SECOND / Number(seq.timebase);
      } catch (e) {
        frameRate = null;
      }

      try {
        durationSeconds = (Number(seq.end) - Number(seq.zeroPoint)) / TICKS_PER_SECOND;
      } catch (e) {
        durationSeconds = null;
      }

      sequences.push({
        name: seq.name,
        sequenceID: seq.sequenceID,
        frameRate: frameRate,
        durationSeconds: durationSeconds
      });
    }

    var numRootItems = null;
    try {
      numRootItems = proj.rootItem.children.numItems;
    } catch (e) {
      numRootItems = null;
    }

    var result = {
      name: proj.name,
      path: proj.path,
      numSequences: proj.sequences.numSequences,
      sequences: sequences,
      numRootItems: numRootItems
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
