// Command: add-text-overlay → ppb_addTextOverlay
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — secondsToTicksString is already
// defined there.
//
// Ported from leancoderkavy's premiere-pro-mcp text.ts add_text_overlay —
// EXACTLY as that reference implements it, including its own documented
// caveat: "Premiere's ExtendScript API does not expose Essential-Graphics
// title creation" (confirmed independently in PREMIERE_API_NOTES.md's
// "No title-creation API exists" line — createNewTitle is gone, Essential
// Graphics titles cannot be scripted), so this routes text through the
// Captions/Subtitle API instead of a real freeform title.
//
// ⚠️ API ARITY CONFLICT (documented honestly, not resolved): this file
// calls seq.createCaptionTrack(formatNum) with ONE argument, matching
// text.ts's own implementation byte-for-byte. PREMIERE_API_NOTES.md's
// "Captions" line documents a DIFFERENT, 3-argument signature —
// seq.createCaptionTrack(srtProjectItem, startSeconds, formatConstant) —
// which is what this panel's own create-caption-track command uses. The
// two reference tools this panel ports from disagree on arity for the
// same underlying call, and text.ts's 1-arg form has NOT been live-tested
// against this Premiere build — it may throw "Illegal Parameter type" (a
// known failure mode elsewhere in this codebase when a call's real arity
// is wrong). If this command fails, prefer create-caption-track (which
// requires an actual imported .srt project item) or render a PNG
// externally and import it, per PREMIERE_API_NOTES.md's own suggested
// alternatives.
//
// formatMap below is text.ts's own numeric map (Sequence.captionFormat),
// NOT the Sequence.CAPTION_FORMAT_* named constants create-caption-track
// uses — kept separate deliberately since this file mirrors text.ts
// exactly per its own convention.
function ppb_addTextOverlay(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (typeof args.text !== "string" || !args.text) {
      return JSON.stringify({ ok: false, error: "text is required" });
    }

    var startSeconds = typeof args.startSeconds === "number" ? args.startSeconds : 0;
    var durationSeconds = typeof args.durationSeconds === "number" ? args.durationSeconds : 5;

    var formatMap = { "subtitle": 3, "608": 1, "708": 2, "teletext": 4 };
    var captionFormat = (typeof args.captionFormat === "string" && formatMap.hasOwnProperty(args.captionFormat)) ? args.captionFormat : "subtitle";
    var formatNum = formatMap[captionFormat];

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ ok: false, error: "no active sequence" });
    }

    var startTicks = secondsToTicksString(startSeconds);
    var endTicks = secondsToTicksString(startSeconds + durationSeconds);

    var captionTrack = null;
    try {
      captionTrack = seq.createCaptionTrack(formatNum);
    } catch (eCT) {
      return JSON.stringify({ ok: false, error: "createCaptionTrack failed: " + eCT.toString() });
    }
    if (!captionTrack) {
      return JSON.stringify({ ok: false, error: "could not create caption track" });
    }

    var newCap = null;
    var textSetError = null;
    try {
      newCap = captionTrack.addCaption(startTicks, endTicks);
      if (newCap) {
        try { newCap.text = args.text; } catch (eT) { textSetError = eT.toString(); }
      }
    } catch (eAdd) {
      return JSON.stringify({ ok: false, error: "addCaption failed: " + eAdd.toString() });
    }

    return JSON.stringify({
      ok: true,
      result: {
        added: true,
        text: args.text,
        captionFormat: formatNum,
        captionFormatName: captionFormat,
        startSeconds: startSeconds,
        durationSeconds: durationSeconds,
        textSetError: textSetError,
        note: "Routed through the Captions API per text.ts's own approach — no Essential-Graphics title-creation API exists on this build. Not live-tested; the 1-arg createCaptionTrack() form conflicts with the 3-arg form PREMIERE_API_NOTES.md documents (see file header comment)."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
