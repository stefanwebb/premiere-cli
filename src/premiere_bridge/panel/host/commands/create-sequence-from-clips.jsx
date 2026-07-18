// Command: create-sequence-from-clips → ppb_createSequenceFromClips
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there. Helper names are prefixed
// ppbCreateSeqFromClips_ to avoid colliding with same-purpose helpers in
// other lazily-loaded command files evaluated into this same global
// context (e.g. add-to-timeline.jsx's own project-item walker).
//
// Ported from leancoderkavy/premiere-pro-mcp's advanced.ts
// create_sequence_from_clips tool:
// `app.project.createNewSequenceFromClips(name, itemsArray[, targetBin])`
// per PREMIERE_API_NOTES.md's Sequences table ("auto-detects settings from
// first clip"). nodeIds resolve to project items via the same recursive
// bin walk used elsewhere in this panel (list-project-items.jsx,
// add-to-timeline.jsx); targetBinPath (if given) is resolved the same
// '/'-separated way as create-sequence's --bin, but is NEVER auto-created
// here (same convention as get-bin-contents.jsx) — pass an existing bin
// path only.
function ppbCreateSeqFromClips_findItem(item, nodeId, depth) {
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
  try { matched = item.nodeId === nodeId; } catch (e) { matched = false; }
  if (matched) {
    return item;
  }
  if (isBin && item.children) {
    for (var i = 0; i < item.children.numItems; i++) {
      var found = ppbCreateSeqFromClips_findItem(item.children[i], nodeId, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function ppbCreateSeqFromClips_resolveItem(nodeId) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var found = ppbCreateSeqFromClips_findItem(root.children[i], nodeId, 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function ppbCreateSeqFromClips_resolveBin(binPath) {
  var segments = binPath.split("/").filter(function (s) { return s.length > 0; });
  var currentBin = app.project.rootItem;
  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    var found = null;
    for (var j = 0; j < currentBin.children.numItems; j++) {
      var child = currentBin.children[j];
      if (child.name === segment && child.type === ProjectItemType.BIN) {
        found = child;
        break;
      }
    }
    if (!found) {
      return null;
    }
    currentBin = found;
  }
  return currentBin;
}

function ppb_createSequenceFromClips(argsJson) {
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
    if (!args.name || typeof args.name !== "string") {
      return JSON.stringify({ ok: false, error: "name is required" });
    }

    var nodeIds = args.nodeIds;
    if (!nodeIds || !(nodeIds instanceof Array) || nodeIds.length === 0) {
      return JSON.stringify({ ok: false, error: "nodeIds must be a non-empty array" });
    }

    var items = [];
    var notFound = [];
    for (var i = 0; i < nodeIds.length; i++) {
      var item = ppbCreateSeqFromClips_resolveItem(nodeIds[i]);
      if (item) {
        items.push(item);
      } else {
        notFound.push(nodeIds[i]);
      }
    }
    if (notFound.length > 0) {
      return JSON.stringify({ ok: false, error: "could not find project item(s) for nodeId(s): " + notFound.join(", ") });
    }

    var targetBin = null;
    if (args.targetBinPath && typeof args.targetBinPath === "string") {
      targetBin = ppbCreateSeqFromClips_resolveBin(args.targetBinPath);
      if (!targetBin) {
        return JSON.stringify({ ok: false, error: "targetBinPath \"" + args.targetBinPath + "\" does not exist (not auto-created)" });
      }
    }

    var numSequencesBefore = app.project.sequences.numSequences;

    var callError = null;
    try {
      if (targetBin) {
        app.project.createNewSequenceFromClips(args.name, items, targetBin);
      } else {
        app.project.createNewSequenceFromClips(args.name, items);
      }
    } catch (e) {
      callError = e.toString();
    }

    var numSequencesAfter = app.project.sequences.numSequences;

    if (callError !== null || numSequencesAfter <= numSequencesBefore) {
      return JSON.stringify({
        ok: false,
        error: callError !== null
          ? ("createNewSequenceFromClips() failed: " + callError)
          : "createNewSequenceFromClips() did not throw, but the project's sequence count did not increase",
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter
      });
    }

    var newSeq = findSequenceByName(args.name);
    if (!newSeq) {
      return JSON.stringify({
        ok: false,
        error: "sequence count increased but no sequence named \"" + args.name + "\" was found afterward",
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter
      });
    }

    return JSON.stringify({
      ok: true,
      result: {
        name: newSeq.name,
        sequenceID: newSeq.sequenceID,
        clipCount: items.length,
        targetBinPath: args.targetBinPath || null,
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
