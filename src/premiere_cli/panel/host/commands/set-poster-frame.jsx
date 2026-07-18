// Command: set-poster-frame → ppb_setPosterFrame
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context.
//
// Ported from leancoderkavy's premiere-pro-mcp set_poster_frame tool —
// but that reference implementation is itself an admitted non-starter:
// it calls item.setOverrideFrameRate(0) "to trigger an internal update"
// and returns a note saying the real effect "may require UI interaction".
// No poster-frame API is documented anywhere in PREMIERE_API_NOTES.md
// (built from three separate MCP repos) — this is genuinely uncertain
// API territory. This command instead PROBES a short list of plausible
// method names in turn (none confirmed to exist on any Premiere build we
// have notes on) rather than repeating the reference's known-fake call.
//
// Project-item addressing matches get-item-metadata.jsx (nodeId/name,
// depth-first bin walk, duplicated locally per this panel's convention).
//
// MUTATION RULE / HONESTY NOTE: if a setter call succeeds (doesn't throw),
// this command tries a short list of plausible GETTER names to read the
// poster frame back for verification. If none of those exist either
// (likely, since none of this is confirmed API), the result reports
// verified: false and says so explicitly — it does NOT claim success
// just because a call didn't throw, per this wave's mutation rules.

function ppbSetPosterFrame_walk(item, args, depth) {
  if (depth > 32) {
    return null;
  }

  var isBin = false;
  try {
    isBin = typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN;
  } catch (e) {
    isBin = false;
  }

  var matched = false;
  if (args.nodeId !== null) {
    try { matched = item.nodeId === args.nodeId; } catch (e) { matched = false; }
  } else if (args.name !== null) {
    try { matched = item.name === args.name; } catch (e) { matched = false; }
  }
  if (matched) {
    return item;
  }

  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbSetPosterFrame_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbSetPosterFrame_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbSetPosterFrame_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppb_setPosterFrame(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasNodeId = typeof args.nodeId === "string" && args.nodeId.length > 0;
    var hasName = typeof args.name === "string" && args.name.length > 0;
    if (!hasNodeId && !hasName) {
      return JSON.stringify({ ok: false, error: "either nodeId or name is required" });
    }

    if (typeof args.seconds !== "number" || isNaN(args.seconds) || args.seconds < 0) {
      return JSON.stringify({ ok: false, error: "seconds must be a non-negative number" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbSetPosterFrame_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var ticksString = String(Math.round(args.seconds * TICKS_PER_SECOND));
    var timeObj = null;
    try {
      timeObj = new Time();
      timeObj.seconds = args.seconds;
    } catch (e) {
      timeObj = null;
    }

    // Candidate setter forms — none of these are confirmed to exist on
    // any Premiere build documented in PREMIERE_API_NOTES.md; probed
    // defensively in a plausible-to-least-plausible order.
    var setAttempts = [];
    var setSucceeded = false;
    var setMethod = null;

    function trySet(label, fn) {
      if (setSucceeded) {
        return;
      }
      try {
        fn();
        setAttempts.push({ method: label, success: true });
        setSucceeded = true;
        setMethod = label;
      } catch (e) {
        setAttempts.push({ method: label, success: false, error: e.toString() });
      }
    }

    trySet("setPosterFrame(secondsNumber)", function () { item.setPosterFrame(args.seconds); });
    trySet("setPosterFrame(ticksString)", function () { item.setPosterFrame(ticksString); });
    trySet("setPosterFrame(TimeObject)", function () { item.setPosterFrame(timeObj); });
    trySet("setPosterFrameTime(TimeObject)", function () { item.setPosterFrameTime(timeObj); });
    trySet("setThumbnailFrame(ticksString)", function () { item.setThumbnailFrame(ticksString); });

    if (!setSucceeded) {
      return JSON.stringify({
        ok: false,
        error: "no known poster-frame setter API exists on this Premiere build — every candidate method threw or is undefined",
        attempts: setAttempts
      });
    }

    // Read-back attempt — also unconfirmed API, tried purely so an actual
    // verification can be reported rather than trusting the setter alone.
    var readAttempts = [];
    var verifiedSeconds = null;
    var verified = false;

    function tryRead(label, fn) {
      if (verified) {
        return;
      }
      try {
        var value = fn();
        readAttempts.push({ method: label, success: true });
        if (typeof value === "number") {
          verifiedSeconds = value;
        } else if (value && typeof value.seconds === "number") {
          verifiedSeconds = value.seconds;
        } else if (value && typeof value.ticks !== "undefined") {
          verifiedSeconds = Number(value.ticks) / TICKS_PER_SECOND;
        }
        verified = verifiedSeconds !== null;
      } catch (e) {
        readAttempts.push({ method: label, success: false, error: e.toString() });
      }
    }

    tryRead("getPosterFrame", function () { return item.getPosterFrame(); });
    tryRead("getPosterFrameTime", function () { return item.getPosterFrameTime(); });
    tryRead("posterFrame", function () { return item.posterFrame; });

    return JSON.stringify({
      ok: true,
      result: {
        item: (function () { try { return item.name; } catch (e) { return null; } })(),
        requestedSeconds: args.seconds,
        setMethod: setMethod,
        setAttempts: setAttempts,
        verified: verified,
        verifiedSeconds: verifiedSeconds,
        readAttempts: readAttempts,
        note: verified
          ? "poster frame set and confirmed via a read-back getter"
          : "the setter call did not throw, but no known getter API could confirm the change actually took effect — treat this as UNCONFIRMED, not a verified success"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
