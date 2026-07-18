// Command: list-markers → ppb_listMarkers
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Standard-DOM read only. Same marker iteration pattern as
// get-full-sequence-info.jsx (getFirstMarker/getNextMarker, capped at
// 10000 to guard against a pathological linked list) — duplicated locally
// since each command file loads independently and cannot rely on helpers
// defined only in another command file.

function ppbListMarkers_serialize(seq) {
  var markers = [];
  var m = seq.markers.getFirstMarker();
  var iterations = 0;
  while (m !== null && typeof m !== "undefined" && iterations < 10000) {
    var entry = { name: null, comments: null, type: null, startSeconds: null, endSeconds: null, guid: null };
    try { entry.name = m.name; } catch (e) { entry.name = null; }
    try { entry.comments = m.comments; } catch (e) { entry.comments = null; }
    try { entry.type = m.type; } catch (e) { entry.type = null; }
    try { entry.startSeconds = timeValueToSeconds(m.start); } catch (e) { entry.startSeconds = null; }
    try { entry.endSeconds = timeValueToSeconds(m.end); } catch (e) { entry.endSeconds = null; }
    try { entry.guid = m.guid; } catch (e) { entry.guid = null; }
    markers.push(entry);

    m = seq.markers.getNextMarker(m);
    iterations++;
  }
  return markers;
}

function ppb_listMarkers(argsJson) {
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

    var markers = [];
    try {
      markers = ppbListMarkers_serialize(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "failed to read markers: " + e.toString() });
    }

    return JSON.stringify({ ok: true, result: { sequenceName: seq.name, markers: markers, markerCount: markers.length } });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
