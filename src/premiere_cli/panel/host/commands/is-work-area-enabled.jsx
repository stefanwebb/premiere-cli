// Command: is-work-area-enabled → ppb_isWorkAreaEnabled
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's sequence.ts
// is_work_area_enabled. Standard DOM only — no QE needed.
function ppb_isWorkAreaEnabled(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var seq = null;
    if (args.sequenceName && typeof args.sequenceName === "string") {
      seq = findSequenceByName(args.sequenceName);
      if (!seq) {
        return JSON.stringify({ ok: false, error: "no sequence named \"" + args.sequenceName + "\" is open" });
      }
    } else {
      seq = app.project.activeSequence;
      if (!seq) {
        return JSON.stringify({ ok: false, error: "no active sequence, and no sequenceName given" });
      }
    }

    // seq.isWorkAreaBarEnabled() does not exist on this Premiere 2026
    // build (live-tested 2026-07-17: "is not a function") — probe the
    // known naming variants in turn, reporting which one answered.
    var enabled = null;
    var form = null;
    var probeErrors = [];
    try {
      if (typeof seq.isWorkAreaBarEnabled === "function") {
        enabled = seq.isWorkAreaBarEnabled();
        form = "isWorkAreaBarEnabled()";
      }
    } catch (e) {
      probeErrors.push("isWorkAreaBarEnabled(): " + e.toString());
    }
    if (form === null) {
      try {
        if (typeof seq.getWorkAreaBarEnabled === "function") {
          enabled = seq.getWorkAreaBarEnabled();
          form = "getWorkAreaBarEnabled()";
        }
      } catch (e) {
        probeErrors.push("getWorkAreaBarEnabled(): " + e.toString());
      }
    }
    if (form === null) {
      try {
        if (typeof seq.workAreaEnabled !== "undefined") {
          enabled = seq.workAreaEnabled;
          form = "workAreaEnabled property";
        }
      } catch (e) {
        probeErrors.push("workAreaEnabled: " + e.toString());
      }
    }

    if (form === null) {
      return JSON.stringify({
        ok: false,
        error: "no known work-area-enabled API exists on this Premiere build (probed isWorkAreaBarEnabled(), getWorkAreaBarEnabled(), workAreaEnabled)",
        probeErrors: probeErrors
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        workAreaEnabled: enabled,
        form: form
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
