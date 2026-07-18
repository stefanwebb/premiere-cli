// Command: delete-marker → ppb_deleteMarker
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, timeValueToSeconds, ...) are already defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp delete_marker tool, but
// re-addressed like update-marker.jsx: identifies the target by .guid
// rather than matching a time value within a tolerance window. Deletion
// itself is markers.deleteMarker(marker) per PREMIERE_API_NOTES.md.
//
// Also accepts PROJECT-ITEM addressing (nodeId or itemName instead of
// sequenceName) to delete markers created by add-marker-to-project-item —
// needed because undo is non-functional on this Premiere 2026 build
// (app.project.undo missing; qe.project.undo is a confirmed silent no-op),
// so item markers would otherwise be undeletable from the bridge.
//
// MUTATION RULE: verified by comparing the collection's total marker count
// before and after (must drop by exactly one) AND confirming the guid no
// longer appears in a fresh getFirstMarker()/getNextMarker() walk — never
// trusting deleteMarker()'s own (lack of a) return value.

function ppbDeleteMarker_findByGuidAndCount(markerCollection, guid, markerName) {
  var found = null;
  var matches = 0;
  var count = 0;
  var m = markerCollection.getFirstMarker();
  var iterations = 0;
  while (m !== null && typeof m !== "undefined" && iterations < 10000) {
    count++;
    var thisGuid = null;
    var thisName = null;
    try { thisGuid = m.guid; } catch (e) { thisGuid = null; }
    try { thisName = m.name; } catch (e) { thisName = null; }
    var isMatch = (guid !== null && thisGuid === guid) ||
                  (guid === null && markerName !== null && thisName === markerName);
    if (isMatch) {
      found = m;
      matches++;
    }
    m = markerCollection.getNextMarker(m);
    iterations++;
  }
  return { found: found, count: count, matches: matches };
}

// Depth-first project-item lookup by nodeId or exact name (same approach
// as get-project-item-info's walker: recurse on children presence, NOT on
// isBin — the root item's type is ROOT).
function ppbDeleteMarker_findItem(item, nodeId, name, depth) {
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
      var found = ppbDeleteMarker_findItem(item.children[i], nodeId, name, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppb_deleteMarker(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasGuid = typeof args.guid === "string" && args.guid.length > 0;
    var hasMarkerName = typeof args.markerName === "string" && args.markerName.length > 0;
    if (!hasGuid && !hasMarkerName) {
      return JSON.stringify({ ok: false, error: "one of guid or markerName is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    var hasItemAddress = (typeof args.nodeId === "string" && args.nodeId.length > 0) ||
                         (typeof args.itemName === "string" && args.itemName.length > 0);

    var markerCollection = null;
    var scopeLabel = null;

    if (hasItemAddress) {
      // Project-item marker deletion
      var item = ppbDeleteMarker_findItem(
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

    var guidArg = hasGuid ? args.guid : null;
    var nameArg = hasMarkerName ? args.markerName : null;
    var before = ppbDeleteMarker_findByGuidAndCount(markerCollection, guidArg, nameArg);
    if (!before.found) {
      return JSON.stringify({ ok: false, error: "no marker found matching " + (hasGuid ? "guid \"" + args.guid + "\"" : "name \"" + args.markerName + "\"") + " on " + scopeLabel });
    }
    if (!hasGuid && before.matches > 1) {
      return JSON.stringify({ ok: false, error: before.matches + " markers named \"" + args.markerName + "\" on " + scopeLabel + " — use --guid to disambiguate" });
    }

    try {
      markerCollection.deleteMarker(before.found);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "deleteMarker failed: " + e.toString() });
    }

    var after = ppbDeleteMarker_findByGuidAndCount(markerCollection, guidArg, nameArg);

    var deleted = after.found === null && after.count === before.count - 1;

    if (!deleted) {
      return JSON.stringify({
        ok: false,
        error: "deleteMarker did not throw, but the marker count/guid check afterward doesn't confirm deletion",
        countBefore: before.count,
        countAfter: after.count,
        stillPresent: after.found !== null
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        scope: hasItemAddress ? "projectItem" : "sequence",
        scopeName: scopeLabel,
        deleted: true,
        guid: hasGuid ? args.guid : null,
        markerName: hasMarkerName ? args.markerName : null,
        markerCountBefore: before.count,
        markerCountAfter: after.count
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
