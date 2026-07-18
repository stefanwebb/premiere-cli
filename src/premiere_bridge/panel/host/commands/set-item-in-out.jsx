// Command: set-item-in-out → ppb_setItemInOut
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's track-targeting.ts
// set_item_in_out — sets in/out points on a PROJECT item (not a timeline
// clip), via item.setInPoint(ticks, mediaType)/setOutPoint(ticks,
// mediaType) per PREMIERE_API_NOTES.md's Project/bins/import section
// (mediaType: 1=video, 2=audio, 4=all — defaults to 4).
//
// Project-item addressing: at least one of nodeId/name is required.
// nodeId matched exactly; name matched exactly against item.name (first
// match wins, depth-first) — same convention as get-item-metadata.jsx.
// This lookup is duplicated per command file (prefixed
// ppbFindItemSetItemInOut_) since each command file loads independently.

function ppbFindItemSetItemInOut_walk(item, args, depth) {
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
      var found = ppbFindItemSetItemInOut_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbFindItemSetItemInOut_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbFindItemSetItemInOut_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

// Reads back the item's in/out point via a probed list of plausible
// getters — no getInPoint()/getOutPoint() getter is documented for
// PROJECT items in PREMIERE_API_NOTES.md (only the setter pair is), so
// this probes a short candidate list and reports honestly if none exist,
// rather than assuming a getter that may not be there.
function ppbReadItemPoint(item, getterNames, mediaType) {
  for (var i = 0; i < getterNames.length; i++) {
    var name = getterNames[i];
    if (typeof item[name] !== "function") {
      continue;
    }
    try {
      var raw = item[name](mediaType);
      var seconds = null;
      if (raw !== null && typeof raw !== "undefined") {
        if (typeof raw === "object" && typeof raw.seconds === "number") {
          seconds = raw.seconds;
        } else {
          var n = Number(raw);
          if (!isNaN(n)) {
            seconds = n / TICKS_PER_SECOND;
          }
        }
      }
      return { getterUsed: name, seconds: seconds };
    } catch (e) {
      // try next candidate
    }
  }
  return { getterUsed: null, seconds: null };
}

function ppb_setItemInOut(argsJson) {
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
    var hasIn = typeof args.inSeconds === "number" && !isNaN(args.inSeconds);
    var hasOut = typeof args.outSeconds === "number" && !isNaN(args.outSeconds);
    if (!hasIn && !hasOut) {
      return JSON.stringify({ ok: false, error: "at least one of inSeconds/outSeconds is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var item = ppbFindItemSetItemInOut_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var mediaType = (typeof args.mediaType === "number" && [1, 2, 4].indexOf(args.mediaType) !== -1) ? args.mediaType : 4;

    var inGetterNames = ["getInPoint", "inPoint"];
    var outGetterNames = ["getOutPoint", "outPoint"];
    var previousIn = ppbReadItemPoint(item, inGetterNames, mediaType);
    var previousOut = ppbReadItemPoint(item, outGetterNames, mediaType);

    var inSetError = null;
    var outSetError = null;

    if (hasIn) {
      try {
        var inTime = new Time();
        inTime.seconds = args.inSeconds;
        item.setInPoint(inTime.ticks, mediaType);
      } catch (e) {
        inSetError = e.toString();
      }
    }
    if (hasOut) {
      try {
        var outTime = new Time();
        outTime.seconds = args.outSeconds;
        item.setOutPoint(outTime.ticks, mediaType);
      } catch (e) {
        outSetError = e.toString();
      }
    }

    var newIn = ppbReadItemPoint(item, inGetterNames, mediaType);
    var newOut = ppbReadItemPoint(item, outGetterNames, mediaType);

    return JSON.stringify({
      ok: (hasIn ? inSetError === null : true) && (hasOut ? outSetError === null : true),
      result: {
        name: item.name,
        nodeId: item.nodeId,
        mediaType: mediaType,
        inSet: hasIn && inSetError === null,
        outSet: hasOut && outSetError === null,
        inSetError: inSetError,
        outSetError: outSetError,
        previousInSeconds: previousIn.seconds,
        previousOutSeconds: previousOut.seconds,
        requestedInSeconds: hasIn ? args.inSeconds : null,
        requestedOutSeconds: hasOut ? args.outSeconds : null,
        newInSeconds: newIn.seconds,
        newOutSeconds: newOut.seconds,
        readBackGetterUsed: { inPoint: newIn.getterUsed, outPoint: newOut.getterUsed },
        note: newIn.getterUsed === null && newOut.getterUsed === null
          ? "no getInPoint/getOutPoint-style getter was found on this build — read-back verification is unavailable, only the setter's non-throw result is confirmed"
          : null
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
