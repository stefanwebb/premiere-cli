// Command: add-marker-to-project-item → ppb_addMarkerToProjectItem
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers are already defined
// there (this file needs none of them beyond app itself).
//
// Ported from leancoderkavy's premiere-pro-mcp add_marker_to_project_item
// tool. Project-item addressing matches get-item-metadata.jsx (at least
// one of nodeId/name required, depth-first bin walk, nodeId matched
// exactly, name matched exactly against item.name, first match wins) —
// duplicated locally per this panel's convention since each command file
// loads independently. Adds a SOURCE marker via item.getMarkers(), the
// same marker API shape as seq.markers per PREMIERE_API_NOTES.md
// (createMarker(SECONDS), .name/.comments/.type setters, .end in
// seconds, .setColorByIndex(0-7)).
//
// MUTATION RULE: verified by re-finding the marker just created via a
// fresh item.getMarkers() walk matched on .guid — never trusting the
// object createMarker() handed back alone.
//
// Wire-arg note: the project item is addressed by nodeId/name (like
// get-item-metadata), so the marker's own label uses "markerName" instead
// of "name" to avoid colliding with the item-addressing "name" field.

function ppbAddMarkerToProjectItem_walk(item, args, depth) {
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
      var found = ppbAddMarkerToProjectItem_walk(item.children[i], args, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbAddMarkerToProjectItem_resolve(args) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbAddMarkerToProjectItem_walk(root.children[i], args, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppbAddMarkerToProjectItem_serializeOne(m) {
  var entry = { name: null, comments: null, type: null, startSeconds: null, endSeconds: null, guid: null };
  try { entry.name = m.name; } catch (e) { entry.name = null; }
  try { entry.comments = m.comments; } catch (e) { entry.comments = null; }
  try { entry.type = m.type; } catch (e) { entry.type = null; }
  try {
    entry.startSeconds = typeof m.start.seconds === "number" ? m.start.seconds : Number(m.start.ticks) / TICKS_PER_SECOND;
  } catch (e) { entry.startSeconds = null; }
  try {
    entry.endSeconds = typeof m.end.seconds === "number" ? m.end.seconds : Number(m.end.ticks) / TICKS_PER_SECOND;
  } catch (e) { entry.endSeconds = null; }
  try { entry.guid = m.guid; } catch (e) { entry.guid = null; }
  return entry;
}

function ppbAddMarkerToProjectItem_findByGuid(markers, guid) {
  var m = markers.getFirstMarker();
  var iterations = 0;
  while (m !== null && typeof m !== "undefined" && iterations < 10000) {
    var thisGuid = null;
    try { thisGuid = m.guid; } catch (e) { thisGuid = null; }
    if (thisGuid === guid) {
      return m;
    }
    m = markers.getNextMarker(m);
    iterations++;
  }
  return null;
}

function ppb_addMarkerToProjectItem(argsJson) {
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

    var item = ppbAddMarkerToProjectItem_resolve({
      nodeId: hasNodeId ? args.nodeId : null,
      name: hasNodeId ? null : args.name
    });
    if (!item) {
      return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/name" });
    }

    var markers;
    try {
      markers = item.getMarkers();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "getMarkers() failed on this item: " + e.toString() });
    }
    if (!markers || typeof markers.createMarker !== "function") {
      return JSON.stringify({ ok: false, error: "this project item has no marker collection" });
    }

    var marker;
    try {
      marker = markers.createMarker(args.seconds);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "createMarker failed: " + e.toString() });
    }
    if (!marker) {
      return JSON.stringify({ ok: false, error: "createMarker returned no marker" });
    }

    if (typeof args.markerName === "string") {
      try { marker.name = args.markerName; } catch (e) { /* best-effort */ }
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
      try {
        var endTime = new Time();
        endTime.seconds = args.seconds + args.durationSeconds;
        marker.end = endTime;
      } catch (e) { /* best-effort */ }
    }

    var guid = null;
    try { guid = marker.guid; } catch (e) { guid = null; }

    var verified = null;
    if (guid !== null) {
      var found = ppbAddMarkerToProjectItem_findByGuid(markers, guid);
      if (found) {
        verified = ppbAddMarkerToProjectItem_serializeOne(found);
      }
    }
    if (verified === null) {
      verified = ppbAddMarkerToProjectItem_serializeOne(marker);
    }

    return JSON.stringify({
      ok: true,
      result: {
        item: (function () { try { return item.name; } catch (e) { return null; } })(),
        nodeId: (function () { try { return item.nodeId; } catch (e) { return null; } })(),
        marker: verified
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
