// Command: link-selection → ppb_linkSelection
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// timeValueToSeconds, ...) are already defined there.
//
// Links the currently-selected video and audio clips in a sequence.
// Ported from leancoderkavy's premiere-pro-mcp `link_selection` tool
// (advanced.ts: `seq.linkSelection()`). This is the STANDARD DOM, not QE
// — per QE_DOM_NOTES.md, the QE DOM has no link/unlink method at all;
// link/unlink only exists here, and operates on whatever is currently
// selected (select clips first via set-clip-selection/select-clips-by-
// name/etc., or seq.getSelection() will be empty and this is a no-op).
// There's no boolean return value or "is linked" property to check
// (PREMIERE_API_NOTES.md: "no is-linked property — repos detect links
// heuristically"), so this command reports the sequence's selection
// before AND after the call — the same TrackItem set should still be
// selected, now linked — rather than claiming a verified link state.

function ppbLinkSelection_collect(seq) {
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

function ppb_linkSelection(argsJson) {
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

    if (typeof seq.linkSelection !== "function") {
      return JSON.stringify({ ok: false, error: "seq.linkSelection is not available on this Premiere build" });
    }

    var before = ppbLinkSelection_collect(seq);
    if (before.selectedCount === 0) {
      return JSON.stringify({
        ok: false,
        error: "nothing is selected in sequence \"" + seq.name + "\" — select the video/audio clips to link first (e.g. via set-clip-selection)"
      });
    }

    try {
      seq.linkSelection();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "seq.linkSelection() failed: " + e.toString() });
    }

    var after = ppbLinkSelection_collect(seq);

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
