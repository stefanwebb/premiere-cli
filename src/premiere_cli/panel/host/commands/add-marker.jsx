// Command: add-marker → ppb_addMarker
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp add_marker tool — adds a
// marker to the ACTIVE (or named) SEQUENCE's own marker collection
// (seq.markers), not a project item (see add-marker-to-project-item.jsx
// for that). Per PREMIERE_API_NOTES.md: markers.createMarker(SECONDS)
// returns the new marker; .name/.comments/.type are plain setters; .end
// is also a SECONDS value (not ticks, despite everything else in this
// panel using ticks strings); color is set via .setColorByIndex(0-7).
//
// MUTATION RULE: verified by re-finding the marker just created via a
// fresh getFirstMarker()/getNextMarker() walk matched on .guid (never
// trusting the object createMarker() handed back alone) and serializing
// that freshly-read marker back to the caller.

function ppbAddMarker_serializeOne(m) {
  var entry = { name: null, comments: null, type: null, startSeconds: null, endSeconds: null, guid: null };
  try { entry.name = m.name; } catch (e) { entry.name = null; }
  try { entry.comments = m.comments; } catch (e) { entry.comments = null; }
  try { entry.type = m.type; } catch (e) { entry.type = null; }
  try { entry.startSeconds = timeValueToSeconds(m.start); } catch (e) { entry.startSeconds = null; }
  try { entry.endSeconds = timeValueToSeconds(m.end); } catch (e) { entry.endSeconds = null; }
  try { entry.guid = m.guid; } catch (e) { entry.guid = null; }
  return entry;
}

function ppbAddMarker_findByGuid(seq, guid) {
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

function ppb_addMarker(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.seconds !== "number" || isNaN(args.seconds) || args.seconds < 0) {
      return JSON.stringify({ ok: false, error: "seconds must be a non-negative number" });
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

    var marker;
    try {
      marker = seq.markers.createMarker(args.seconds);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "createMarker failed: " + e.toString() });
    }
    if (!marker) {
      return JSON.stringify({ ok: false, error: "createMarker returned no marker" });
    }

    if (typeof args.name === "string") {
      try { marker.name = args.name; } catch (e) { /* best-effort */ }
    }
    if (typeof args.comments === "string") {
      try { marker.comments = args.comments; } catch (e) { /* best-effort */ }
    }
    if (typeof args.type === "string") {
      try { marker.type = args.type; } catch (e) { /* best-effort */ }
    }
    if (typeof args.colorIndex === "number") {
      try { marker.setColorByIndex(args.colorIndex); } catch (e) { /* best-effort */ }
    }
    if (typeof args.durationSeconds === "number" && args.durationSeconds > 0) {
      try { marker.end = args.seconds + args.durationSeconds; } catch (e) { /* best-effort */ }
    }

    var guid = null;
    try { guid = marker.guid; } catch (e) { guid = null; }

    var verified = null;
    if (guid !== null) {
      var found = ppbAddMarker_findByGuid(seq, guid);
      if (found) {
        verified = ppbAddMarker_serializeOne(found);
      }
    }
    if (verified === null) {
      // No guid available, or the re-find failed — fall back to
      // serializing the object createMarker handed back directly. Still a
      // live read of the marker's own properties, just not an
      // independently re-fetched one.
      verified = ppbAddMarker_serializeOne(marker);
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        marker: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
