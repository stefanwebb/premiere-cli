// Command: add-adjustment-layer → ppb_addAdjustmentLayer
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, TICKS_PER_SECOND, activateSequenceForQE, ...) are
// already defined there.
//
// Ported from leancoderkavy/premiere-pro-mcp's utility.ts
// add_adjustment_layer, adapted to PREMIERE_API_NOTES.md's PPro 2026
// finding: the legacy `qeSeq.addAdjustmentLayer(track)` one-call path was
// REMOVED in Premiere 2026 — this build only has
// `qe.project.newAdjustmentLayer()`, which creates a project-level
// adjustment-layer ProjectItem but does NOT place it on the timeline by
// itself. This command is therefore two independently-verified steps:
//   1. Create the project item (qe.project.newAdjustmentLayer()) —
//      verified by a root-bin children-count increase, matching the new
//      item by name containing "adjustment" (case-insensitive) among the
//      newly-appeared items (never trusting the call's own return value).
//   2. Place it on the timeline at startSeconds on the given video track
//      via qeTrack.insert()/insertClip() — verified by the target track's
//      QE item count increasing.
// Either step can succeed independently of the other — both are reported
// so a caller can tell "item created but not placed" apart from total
// failure.
function ppb_addAdjustmentLayer(argsJson) {
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

    var trackIndex = typeof args.trackIndex === "number" ? args.trackIndex : 0;
    if (trackIndex >= seq.videoTracks.numTracks) {
      return JSON.stringify({ ok: false, error: "trackIndex " + trackIndex + " is out of range — sequence has " + seq.videoTracks.numTracks + " video track(s)" });
    }

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() returned nothing after activating the sequence" });
    }

    if (typeof qe.project.newAdjustmentLayer !== "function") {
      return JSON.stringify({ ok: false, error: "qe.project.newAdjustmentLayer() is not available on this Premiere build" });
    }

    // --- Step 1: create the project item ---
    var rootChildren = app.project.rootItem.children;
    var namesBefore = {};
    for (var b = 0; b < rootChildren.numItems; b++) {
      var beforeName = null;
      try { beforeName = rootChildren[b].name; } catch (e) { beforeName = null; }
      namesBefore[b + ":" + beforeName] = true;
    }
    var countBefore = rootChildren.numItems;

    var createError = null;
    try {
      qe.project.newAdjustmentLayer();
    } catch (e) {
      createError = e.toString();
    }

    var countAfter = app.project.rootItem.children.numItems;
    var itemCreated = createError === null && countAfter > countBefore;

    if (!itemCreated) {
      return JSON.stringify({
        ok: false,
        error: createError !== null
          ? ("qe.project.newAdjustmentLayer() failed: " + createError)
          : "newAdjustmentLayer() did not throw, but the project's root item count did not increase",
        countBefore: countBefore,
        countAfter: countAfter
      });
    }

    var adjItem = null;
    var freshChildren = app.project.rootItem.children;
    for (var c = freshChildren.numItems - 1; c >= 0; c--) {
      var it = freshChildren[c];
      var itName = null;
      try { itName = it.name; } catch (e) { itName = null; }
      if (itName && itName.toLowerCase().indexOf("adjustment") !== -1) {
        adjItem = it;
        break;
      }
    }
    if (!adjItem) {
      return JSON.stringify({
        ok: false,
        error: "project item count increased after newAdjustmentLayer() but no item with \"adjustment\" in its name could be found",
        countBefore: countBefore,
        countAfter: countAfter
      });
    }

    // --- Step 2: place it on the timeline ---
    var startSeconds = typeof args.startSeconds === "number" ? args.startSeconds : 0;
    var startTicksString = String(Math.round(startSeconds * TICKS_PER_SECOND));

    var qeTrack = null;
    try {
      qeTrack = qeSeq.getVideoTrackAt(trackIndex);
    } catch (e) {
      qeTrack = null;
    }
    if (!qeTrack) {
      return JSON.stringify({
        ok: false,
        error: "QE video track " + trackIndex + " not found — the adjustment-layer project item was created but not placed on the timeline",
        itemCreated: true,
        projectItem: { name: adjItem.name, nodeId: adjItem.nodeId }
      });
    }

    var placeCountBefore = null;
    try { placeCountBefore = qeTrack.numItems; } catch (e) { placeCountBefore = null; }

    var placeError = null;
    var placeAttempts = [];
    var placed = false;
    try {
      qeTrack.insert(adjItem, startTicksString);
      placeAttempts.push({ form: "qeTrack.insert(item, ticksString)", success: true });
      placed = true;
    } catch (e1) {
      placeAttempts.push({ form: "qeTrack.insert(item, ticksString)", success: false, error: e1.toString() });
      try {
        qeTrack.insertClip(adjItem, startTicksString);
        placeAttempts.push({ form: "qeTrack.insertClip(item, ticksString)", success: true });
        placed = true;
      } catch (e2) {
        placeAttempts.push({ form: "qeTrack.insertClip(item, ticksString)", success: false, error: e2.toString() });
        placeError = e2.toString();
      }
    }

    var placeCountAfter = null;
    try { placeCountAfter = qeTrack.numItems; } catch (e) { placeCountAfter = null; }
    var placedVerified = placeCountBefore !== null && placeCountAfter !== null && placeCountAfter > placeCountBefore;

    return JSON.stringify({
      ok: itemCreated && placedVerified,
      result: {
        sequenceName: seq.name,
        trackIndex: trackIndex,
        startSeconds: startSeconds,
        durationSeconds: typeof args.durationSeconds === "number" ? args.durationSeconds : null,
        itemCreated: itemCreated,
        projectItem: { name: adjItem.name, nodeId: adjItem.nodeId },
        placed: placed,
        placedVerified: placedVerified,
        placeCountBefore: placeCountBefore,
        placeCountAfter: placeCountAfter,
        placeAttempts: placeAttempts,
        placeError: placedVerified ? null : placeError,
        note: "durationSeconds is not applied here — no confirmed API trims an inserted QE clip's length directly; use set-item-in-out or trim via the standard DOM after placement if a specific duration is required"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
