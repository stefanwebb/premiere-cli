// Command: get-sequence-markers-by-type → ppb_getSequenceMarkersByType
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Same marker iteration pattern as get-full-sequence-info.jsx and
// list-markers.jsx (getFirstMarker/getNextMarker, capped at 10000),
// filtering to markers whose type matches the requested type.

var PPB_MARKER_TYPES = ["Comment", "Chapter", "Segmentation", "WebLink", "FlashCuePoint"];

function ppbMarkersByType_isValidType(type) {
  for (var i = 0; i < PPB_MARKER_TYPES.length; i++) {
    if (PPB_MARKER_TYPES[i] === type) {
      return true;
    }
  }
  return false;
}

function ppbMarkersByType_serialize(seq, type) {
  var markers = [];
  var m = seq.markers.getFirstMarker();
  var iterations = 0;
  while (m !== null && typeof m !== "undefined" && iterations < 10000) {
    var markerType = null;
    try { markerType = m.type; } catch (e) { markerType = null; }

    if (markerType === type) {
      var entry = { name: null, comments: null, type: markerType, startSeconds: null, endSeconds: null, guid: null };
      try { entry.name = m.name; } catch (e) { entry.name = null; }
      try { entry.comments = m.comments; } catch (e) { entry.comments = null; }
      try { entry.startSeconds = timeValueToSeconds(m.start); } catch (e) { entry.startSeconds = null; }
      try { entry.endSeconds = timeValueToSeconds(m.end); } catch (e) { entry.endSeconds = null; }
      try { entry.guid = m.guid; } catch (e) { entry.guid = null; }
      markers.push(entry);
    }

    m = seq.markers.getNextMarker(m);
    iterations++;
  }
  return markers;
}

function ppb_getSequenceMarkersByType(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.type !== "string" || !ppbMarkersByType_isValidType(args.type)) {
      return JSON.stringify({ ok: false, error: "type must be one of: " + PPB_MARKER_TYPES.join(", ") });
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
      markers = ppbMarkersByType_serialize(seq, args.type);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "failed to read markers: " + e.toString() });
    }

    return JSON.stringify({
      ok: true,
      result: { sequenceName: seq.name, type: args.type, markers: markers, count: markers.length }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
