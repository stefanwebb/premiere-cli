// Command: unlink-selection → ppb_unlinkSelection
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// timeValueToSeconds, ...) are already defined there.
//
// Unlinks the currently-selected video and audio clips in a sequence.
// Ported from leancoderkavy's premiere-pro-mcp `unlink_selection` tool
// (advanced.ts: `seq.unlinkSelection()`) — the standard-DOM counterpart
// of link-selection.jsx; see that file's header for the full context on
// why this is standard DOM (not QE, which has no link/unlink at all) and
// why there's no verified "is linked" state to check. Same before/after
// selection reporting as link-selection.

function ppbUnlinkSelection_collect(seq) {
  var sel = null;
  try {
    sel = seq.getSelection();
  } catch (e) {
    sel = null;
  }
  var selCount = 0;
  if (sel) {
    if (typeof sel.numItems === "number") {
      selCount = sel.numItems;
    } else if (typeof sel.length === "number") {
      selCount = sel.length;
    }
  }
  var items = [];
  var cap = selCount > 20 ? 20 : selCount;
  for (var i = 0; i < cap; i++) {
    var item = sel[i];
    var entry = { name: null, mediaType: null, startSeconds: null, endSeconds: null, nodeId: null };
    try { entry.name = item.name; } catch (e) { entry.name = null; }
    try { entry.mediaType = item.mediaType; } catch (e) { entry.mediaType = null; }
    try { entry.startSeconds = timeValueToSeconds(item.start); } catch (e) { entry.startSeconds = null; }
    try { entry.endSeconds = timeValueToSeconds(item.end); } catch (e) { entry.endSeconds = null; }
    try { entry.nodeId = item.nodeId; } catch (e) { entry.nodeId = null; }
    items.push(entry);
  }
  var out = { selectedCount: selCount, selectedClips: items };
  if (selCount > 20) {
    out.truncated = true;
  }
  return out;
}

function ppb_unlinkSelection(argsJson) {
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

    if (typeof seq.unlinkSelection !== "function") {
      return JSON.stringify({ ok: false, error: "seq.unlinkSelection is not available on this Premiere build" });
    }

    var before = ppbUnlinkSelection_collect(seq);
    if (before.selectedCount === 0) {
      return JSON.stringify({
        ok: false,
        error: "nothing is selected in sequence \"" + seq.name + "\" — select the linked clip(s) to unlink first (e.g. via set-clip-selection)"
      });
    }

    try {
      seq.unlinkSelection();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "seq.unlinkSelection() failed: " + e.toString() });
    }

    var after = ppbUnlinkSelection_collect(seq);

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        before: before,
        after: after,
        note: "there is no confirmed 'is linked' read-back API (PREMIERE_API_NOTES.md) — before/after selection is reported as the only available signal; the call not throwing is the closest thing to success confirmation here."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
