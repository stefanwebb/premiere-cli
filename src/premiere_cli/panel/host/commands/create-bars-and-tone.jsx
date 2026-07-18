// Command: create-bars-and-tone → ppb_createBarsAndTone
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// ensureQEEnabled, ...) are already defined there.
//
// REWRITTEN 2026-07-17 after the probe session (see BUILD_FINDINGS.md
// corrections): the standard-DOM app.project.newBarsAndTone(...) throws
// "Illegal Parameter type" on this build, but the QE 2-arg form —
// qe.project.newBarsAndTone(width, height) — WORKS (found in the
// antipaster/Adobe-Premiere-Pro-MCP repo; live-verified creating an
// "HD Bars and Tone" project item). The QE call takes no name argument;
// Premiere names the item itself (e.g. "HD Bars and Tone"), so a
// requested name is applied afterward via item.name assignment.
// width/height default to 1920x1080 (bars-and-tone is a calibration/
// leader item, not a project deliverable). Verified via a project-tree
// nodeId diff of the root bin's children (never trusting the call's own
// return value). The standard-DOM form is still tried FIRST in case a
// future build repairs it (it accepts a name and timebase natively).

function ppbCreateBarsAndTone_snapshotRootIds() {
  var ids = {};
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var nid = null;
    try { nid = root.children[i].nodeId; } catch (e) { nid = null; }
    if (nid) { ids[nid] = true; }
  }
  return ids;
}

function ppbCreateBarsAndTone_findNewItem(beforeIds) {
  var root = app.project.rootItem;
  for (var i = root.children.numItems - 1; i >= 0; i--) {
    var nid = null;
    try { nid = root.children[i].nodeId; } catch (e) { nid = null; }
    if (nid && !beforeIds.hasOwnProperty(nid)) {
      return root.children[i];
    }
  }
  return null;
}

function ppb_createBarsAndTone(argsJson) {
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

    var width = typeof args.width === "number" ? args.width : 1920;
    var height = typeof args.height === "number" ? args.height : 1080;
    var requestedName = (typeof args.name === "string" && args.name.length > 0) ? args.name : null;

    var attempts = [];
    var newItem = null;
    var methodUsed = null;

    // 1. standard DOM — broken on 26.3.0 ("Illegal Parameter type") but
    // cheap to try in case a future build repairs it.
    if (typeof app.project.newBarsAndTone === "function") {
      var timebase = null;
      try {
        var activeSeq = app.project.activeSequence;
        timebase = activeSeq ? String(activeSeq.timebase) : String(TICKS_PER_SECOND);
      } catch (e) {
        timebase = String(TICKS_PER_SECOND);
      }
      var beforeIds1 = ppbCreateBarsAndTone_snapshotRootIds();
      var att1 = { method: "app.project.newBarsAndTone(w, h, timebaseStr, name)" };
      try {
        app.project.newBarsAndTone(width, height, timebase, requestedName || "Bars and Tone");
        att1.threw = false;
      } catch (e2) {
        att1.threw = true;
        att1.error = e2.toString();
      }
      newItem = ppbCreateBarsAndTone_findNewItem(beforeIds1);
      att1.effective = newItem !== null;
      attempts.push(att1);
      if (newItem) { methodUsed = att1.method; }
    }

    // 2. QE 2-arg form — live-verified working on 26.3.0.
    if (!newItem) {
      try {
        ensureQEEnabled();
      } catch (e3) {
        return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e3.toString(), attempts: attempts });
      }
      if (typeof qe === "undefined" || !qe.project || typeof qe.project.newBarsAndTone !== "function") {
        return JSON.stringify({ ok: false, error: "no working bars-and-tone API on this build (standard DOM failed, qe.project.newBarsAndTone unavailable)", attempts: attempts });
      }
      var beforeIds2 = ppbCreateBarsAndTone_snapshotRootIds();
      var att2 = { method: "qe.project.newBarsAndTone(w, h)" };
      try {
        qe.project.newBarsAndTone(width, height);
        att2.threw = false;
      } catch (e4) {
        att2.threw = true;
        att2.error = e4.toString();
      }
      newItem = ppbCreateBarsAndTone_findNewItem(beforeIds2);
      att2.effective = newItem !== null;
      attempts.push(att2);
      if (newItem) { methodUsed = att2.method; }
    }

    if (!newItem) {
      return JSON.stringify({
        ok: false,
        error: "no bars-and-tone item appeared in the root bin after any attempted call",
        attempts: attempts
      });
    }

    // The QE form takes no name — apply a requested name afterward.
    var premiereGivenName = null;
    try { premiereGivenName = newItem.name; } catch (e5) { premiereGivenName = null; }
    var renamed = null;
    if (requestedName && premiereGivenName !== requestedName) {
      try {
        newItem.name = requestedName;
        renamed = (newItem.name === requestedName);
      } catch (e6) {
        renamed = false;
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        created: true,
        methodUsed: methodUsed,
        attempts: attempts,
        premiereGivenName: premiereGivenName,
        name: (function () { try { return newItem.name; } catch (e) { return premiereGivenName; } })(),
        renamed: renamed,
        width: width,
        height: height,
        nodeId: (function () { try { return newItem.nodeId; } catch (e) { return null; } })()
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
