// Command: set-active-sequence → ppb_setActiveSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's project.ts
// set_active_sequence. Per PREMIERE_API_NOTES.md's Sequences table,
// activation has two documented forms — assignment
// (app.project.activeSequence = seq) and app.project.openSequence(seq.
// sequenceID) — both are tried in order (assignment first, matching the
// reference tool), each verified independently by re-reading
// app.project.activeSequence.name afterward rather than trusting either
// call's return value.

function ppb_setActiveSequence(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.sequenceName || typeof args.sequenceName !== "string") {
      return JSON.stringify({ ok: false, error: "sequenceName is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var seq = findSequenceByName(args.sequenceName);
    if (!seq) {
      return JSON.stringify({ ok: false, error: "no sequence named \"" + args.sequenceName + "\" found in the project" });
    }

    function isNowActive() {
      try {
        return app.project.activeSequence && app.project.activeSequence.name === args.sequenceName;
      } catch (e) {
        return false;
      }
    }

    var attempts = [];

    try {
      app.project.activeSequence = seq;
      var success1 = isNowActive();
      attempts.push({ method: "activeSequenceAssign", success: success1 });
      if (success1) {
        return JSON.stringify({
          ok: true,
          result: { name: seq.name, sequenceID: seq.sequenceID, attempts: attempts }
        });
      }
    } catch (e) {
      attempts.push({ method: "activeSequenceAssign", success: false, error: e.toString() });
    }

    if (typeof app.project.openSequence === "function") {
      try {
        app.project.openSequence(seq.sequenceID);
        var success2 = isNowActive();
        attempts.push({ method: "openSequence", success: success2 });
        if (success2) {
          return JSON.stringify({
            ok: true,
            result: { name: seq.name, sequenceID: seq.sequenceID, attempts: attempts }
          });
        }
      } catch (e) {
        attempts.push({ method: "openSequence", success: false, error: e.toString() });
      }
    } else {
      attempts.push({ method: "openSequence", success: false, error: "app.project.openSequence is not a function on this Premiere build" });
    }

    return JSON.stringify({
      ok: false,
      error: "could not make sequence \"" + args.sequenceName + "\" active with any known method",
      attempts: attempts
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
