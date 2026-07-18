// Command: set-item-start-time → ppb_setItemStartTime
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ports the reference project's media.ts/track-targeting.ts set_start_time
// tool (setStartTime — timecode offset for the source media, not a
// timeline position). Item resolution by nodeId/name uses children-
// presence recursion (NOT an isBin() gate), per get-project-item-info.jsx's
// live-debugged finding. Converts seconds to a ticks string (per
// PREMIERE_API_NOTES.md's item.setStartTime(ticksStr) signature) before
// calling. No confirmed getter exists for a project item's start time on
// this build, so a short list of plausible getter names is probed for
// read-back verification — same defensive pattern as set-poster-frame.

function ppbSetItemStartTime_findByNodeId(item, nodeId, depth) {
  if (depth > 32) {
    return null;
  }
  try {
    if (item.nodeId === nodeId) {
      return item;
    }
  } catch (e) {
    // fall through
  }
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbSetItemStartTime_findByNodeId(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbSetItemStartTime_findByName(item, name, depth) {
  if (depth > 32) {
    return null;
  }
  try {
    if (item.name === name) {
      return item;
    }
  } catch (e) {
    // fall through
  }
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbSetItemStartTime_findByName(item.children[i], name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// Probes a short list of plausible getter names/shapes for a project
// item's start time — none is documented in PREMIERE_API_NOTES.md, unlike
// the well-confirmed getInPoint()/getOutPoint() pair. Returns seconds, or
// null if none of the probed getters exist/succeed.
function ppbSetItemStartTime_probeGetter(item) {
  var candidates = ["getStartTime", "getStartOffset"];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (typeof item[candidates[i]] === "function") {
        var raw = item[candidates[i]]();
        if (raw !== null && typeof raw !== "undefined") {
          return { name: candidates[i], seconds: timeValueToSeconds(raw) };
        }
      }
    } catch (e) {
      // try next candidate
    }
  }
  return null;
}

function ppb_setItemStartTime(argsJson) {
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
    if (typeof args.seconds !== "number") {
      return JSON.stringify({ ok: false, error: "seconds is required and must be a number" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = hasNodeId
      ? ppbSetItemStartTime_findByNodeId(app.project.rootItem, args.nodeId, 0)
      : ppbSetItemStartTime_findByName(app.project.rootItem, args.name, 0);
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var before = ppbSetItemStartTime_probeGetter(item);
    var ticksStr = String(Math.round(args.seconds * TICKS_PER_SECOND));

    try {
      item.setStartTime(ticksStr);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "setStartTime() failed: " + e.toString() });
    }

    var after = ppbSetItemStartTime_probeGetter(item);

    return JSON.stringify({
      ok: true,
      result: {
        nodeId: item.nodeId,
        name: item.name,
        requestedSeconds: args.seconds,
        ticksString: ticksStr,
        previousValue: before ? before.seconds : null,
        newValue: after ? after.seconds : null,
        readBackGetterUsed: after ? after.name : null,
        note: after
          ? null
          : "no confirmed getter for a project item's start time exists on this build — only the setter's non-throw result is confirmed"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
