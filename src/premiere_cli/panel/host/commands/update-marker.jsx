// Command: update-marker → ppb_updateMarker
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp update_marker tool, but
// re-addressed: the reference identifies the target marker by matching
// its start time within a tolerance window; this panel instead identifies
// it by .guid (the same stable identity list-markers/get-clip-markers
// already expose), which is unambiguous and avoids float-time matching
// entirely. Only name/comments/type/colorIndex/endSeconds/durationSeconds
// are mutable here — marker.start itself is not attempted (no confirmed
// write API for it; see PREMIERE_API_NOTES.md's markers section).
//
// MUTATION RULE: after applying changes, the marker is re-found by the
// same guid via a fresh getFirstMarker()/getNextMarker() walk and
// re-serialized from that live object — never returned from the
// reference held before mutating.

function ppbUpdateMarker_serializeOne(m) {
  var entry = { name: null, comments: null, type: null, startSeconds: null, endSeconds: null, guid: null };
  try { entry.name = m.name; } catch (e) { entry.name = null; }
  try { entry.comments = m.comments; } catch (e) { entry.comments = null; }
  try { entry.type = m.type; } catch (e) { entry.type = null; }
  try { entry.startSeconds = timeValueToSeconds(m.start); } catch (e) { entry.startSeconds = null; }
  try { entry.endSeconds = timeValueToSeconds(m.end); } catch (e) { entry.endSeconds = null; }
  try { entry.guid = m.guid; } catch (e) { entry.guid = null; }
  return entry;
}

function ppbUpdateMarker_findByGuid(seq, guid) {
  var m = seq.markers.getFirstMarker();
  var iterations = 0;
  while (m !== null && typeof m !== "undefined" && iterations < 10000) {
    var thisGuid = null;
    try { thisGuid = m.guid; } catch (e) { thisGuid = null; }
    if (thisGuid === guid) {
      return m;
    }
    m = seq.markers.getNextMarker(m);
    iterations++;
  }
  return null;
}

function ppb_updateMarker(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.guid !== "string" || args.guid.length === 0) {
      return JSON.stringify({ ok: false, error: "guid is required" });
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

    var marker = ppbUpdateMarker_findByGuid(seq, args.guid);
    if (!marker) {
      return JSON.stringify({ ok: false, error: "no marker found with guid \"" + args.guid + "\" on this sequence" });
    }

    var applied = {};
    if (typeof args.name === "string") {
      try { marker.name = args.name; applied.name = true; } catch (e) { applied.name = false; }
    }
    if (typeof args.comments === "string") {
      try { marker.comments = args.comments; applied.comments = true; } catch (e) { applied.comments = false; }
    }
    if (typeof args.type === "string") {
      try { marker.type = args.type; applied.type = true; } catch (e) { applied.type = false; }
    }
    if (typeof args.colorIndex === "number") {
      try { marker.setColorByIndex(args.colorIndex); applied.colorIndex = true; } catch (e) { applied.colorIndex = false; }
    }
    if (typeof args.durationSeconds === "number") {
      try {
        var startSeconds = timeValueToSeconds(marker.start);
        marker.end = startSeconds + args.durationSeconds;
        applied.durationSeconds = true;
      } catch (e) { applied.durationSeconds = false; }
    } else if (typeof args.endSeconds === "number") {
      try { marker.end = args.endSeconds; applied.endSeconds = true; } catch (e) { applied.endSeconds = false; }
    }

    var reFound = ppbUpdateMarker_findByGuid(seq, args.guid);
    if (!reFound) {
      return JSON.stringify({ ok: false, error: "marker vanished after update (re-find by guid failed)", applied: applied });
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        applied: applied,
        marker: ppbUpdateMarker_serializeOne(reFound)
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
