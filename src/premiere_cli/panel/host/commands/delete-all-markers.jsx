// Command: delete-all-markers → ppb_deleteAllMarkers
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Batch counterpart to delete-marker.jsx: clears every marker in one
// collection instead of addressing a single one by guid/name. Same
// PROJECT-ITEM addressing (nodeId or itemName instead of sequenceName) as
// delete-marker, for the same undo-non-functional reason documented there.
//
// MUTATION RULE: verified by counting markers before the loop and
// confirming getFirstMarker() returns null afterward — never trusting
// deleteMarker()'s own (lack of a) return value. Deletes by repeatedly
// removing the collection's first marker (rather than snapshotting guids
// up front and deleting each by guid) since deleteMarker() invalidates the
// getNextMarker() walk anyway — this is the same reason delete-marker.jsx
// re-walks the collection after each deletion instead of trusting an
// enumerate-then-delete-by-index loop would still line up.

// Depth-first project-item lookup by nodeId or exact name — duplicated
// from delete-marker.jsx since each command file loads independently.
function ppbDeleteAllMarkers_findItem(item, nodeId, name, depth) {
  if (depth > 32) {
    return null;
  }
  try {
    if (nodeId !== null && item.nodeId === nodeId) {
      return item;
    }
    if (name !== null && item.name === name && item.type !== ProjectItemType.BIN && item.type !== ProjectItemType.ROOT) {
      return item;
    }
  } catch (e) {
    // fall through
  }
  if (item.children && item.children.numItems > 0) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbDeleteAllMarkers_findItem(item.children[i], nodeId, name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbDeleteAllMarkers_count(markerCollection) {
  var count = 0;
  var m = markerCollection.getFirstMarker();
  var iterations = 0;
  while (m !== null && typeof m !== "undefined" && iterations < 10000) {
    count++;
    m = markerCollection.getNextMarker(m);
    iterations++;
  }
  return count;
}

function ppb_deleteAllMarkers(argsJson) {
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

    var hasItemAddress = (typeof args.nodeId === "string" && args.nodeId.length > 0) ||
                         (typeof args.itemName === "string" && args.itemName.length > 0);

    var markerCollection = null;
    var scopeLabel = null;

    if (hasItemAddress) {
      var item = ppbDeleteAllMarkers_findItem(
        app.project.rootItem,
        (typeof args.nodeId === "string" && args.nodeId.length > 0) ? args.nodeId : null,
        (typeof args.itemName === "string" && args.itemName.length > 0) ? args.itemName : null,
        0
      );
      if (!item) {
        return JSON.stringify({ ok: false, error: "no project item found matching the given nodeId/itemName" });
      }
      try {
        markerCollection = item.getMarkers();
      } catch (e) {
        return JSON.stringify({ ok: false, error: "getMarkers() failed on the project item: " + e.toString() });
      }
      scopeLabel = item.name;
    } else {
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
      markerCollection = seq.markers;
      scopeLabel = seq.name;
    }

    var countBefore = ppbDeleteAllMarkers_count(markerCollection);

    var deletedCount = 0;
    var failures = [];
    var iterations = 0;
    var current = markerCollection.getFirstMarker();
    while (current !== null && typeof current !== "undefined" && iterations < 10000) {
      var guidForError = null;
      try { guidForError = current.guid; } catch (e) { guidForError = null; }
      try {
        markerCollection.deleteMarker(current);
        deletedCount++;
      } catch (e) {
        failures.push({ guid: guidForError, error: e.toString() });
        // Deletion failed — advance past this marker instead of looping on it forever.
        current = markerCollection.getNextMarker(current);
        iterations++;
        continue;
      }
      current = markerCollection.getFirstMarker();
      iterations++;
    }

    var countAfter = ppbDeleteAllMarkers_count(markerCollection);
    var cleared = countAfter === 0;

    if (!cleared && failures.length === 0) {
      return JSON.stringify({
        ok: false,
        error: "deleteMarker did not throw for any marker, but " + countAfter + " marker(s) remain afterward",
        countBefore: countBefore,
        countAfter: countAfter
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        scope: hasItemAddress ? "projectItem" : "sequence",
        scopeName: scopeLabel,
        markerCountBefore: countBefore,
        markerCountDeleted: deletedCount,
        markerCountAfter: countAfter,
        failures: failures
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
