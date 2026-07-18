// Command: roll-edit → ppb_rollEdit
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, serializeTrackItem, TICKS_PER_SECOND, ...) are already
// defined there.
//
// Rolls the edit point between the addressed clip and its neighbor —
// moves the shared cut point in time WITHOUT changing the overall
// sequence duration (one clip's out point and the next clip's in point
// move together). Ported from leancoderkavy's premiere-pro-mcp
// `roll_edit` tool (advanced.ts: `qeClip.roll(offsetTicksString)`), whose
// signature is UNCONFIRMED on this build (`roll` is on our own reflect
// list per QE_DOM_NOTES.md/PREMIERE_API_NOTES.md, but never live-called)
// — every plausible argument form is tried in turn (ticks string, then a
// raw seconds number, then a Time object), recording an `attempts` array,
// and success is judged by an actual before/after change in the clip's
// own end time, never by whether the call merely avoided throwing.
// Positive offsetSeconds rolls the edit point later (per the reference
// tool's convention); negative rolls it earlier.

function ppbRollEdit_offsetForms(offsetSeconds) {
  var ticksString = String(Math.round(offsetSeconds * TICKS_PER_SECOND));
  var timeObj = null;
  try {
    timeObj = new Time();
    timeObj.seconds = offsetSeconds;
  } catch (e) {
    timeObj = null;
  }
  var forms = [
    { label: "ticksString", value: ticksString },
    { label: "seconds", value: offsetSeconds }
  ];
  if (timeObj !== null) {
    forms.push({ label: "TimeObject", value: timeObj });
  }
  return forms;
}

function ppb_rollEdit(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (args.trackType !== "video" && args.trackType !== "audio") {
      return JSON.stringify({ ok: false, error: "trackType must be \"video\" or \"audio\"" });
    }
    if (typeof args.trackIndex !== "number" || args.trackIndex < 0 || Math.floor(args.trackIndex) !== args.trackIndex) {
      return JSON.stringify({ ok: false, error: "trackIndex must be a non-negative integer" });
    }
    if (typeof args.clipIndex !== "number" || args.clipIndex < 0 || Math.floor(args.clipIndex) !== args.clipIndex) {
      return JSON.stringify({ ok: false, error: "clipIndex must be a non-negative integer" });
    }
    if (typeof args.offsetSeconds !== "number" || isNaN(args.offsetSeconds) || args.offsetSeconds === 0) {
      return JSON.stringify({ ok: false, error: "offsetSeconds must be a non-zero number" });
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

    var resolved = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    if (resolved.error) {
      return JSON.stringify({ ok: false, error: resolved.error });
    }
    var before = serializeTrackItem(resolved.clip, args.trackIndex, args.clipIndex);

    try {
      ensureQEEnabled();
      activateSequenceForQE(seq);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE()/sequence activation failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var qeSeq;
    try {
      qeSeq = qe.project.getActiveSequence();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() failed: " + e.toString() });
    }
    var qeResolved = resolveQeClip(qeSeq, args.trackType, args.trackIndex, args.clipIndex);
    if (qeResolved.error) {
      return JSON.stringify({ ok: false, error: qeResolved.error });
    }
    var qeClip = qeResolved.qeClip;

    if (typeof qeClip.roll !== "function") {
      return JSON.stringify({ ok: false, error: "qeClip.roll is not available on this Premiere build" });
    }

    var attempts = [];
    var forms = ppbRollEdit_offsetForms(args.offsetSeconds);
    var succeeded = false;
    var formUsed = null;
    for (var i = 0; i < forms.length && !succeeded; i++) {
      try {
        qeClip.roll(forms[i].value);
        attempts.push({ form: forms[i].label, success: true });
        succeeded = true;
        formUsed = forms[i].label;
      } catch (e) {
        attempts.push({ form: forms[i].label, success: false, error: e.toString() });
      }
    }

    if (!succeeded) {
      return JSON.stringify({
        ok: false,
        error: "qeClip.roll() failed with every argument form tried",
        attempts: attempts
      });
    }

    var afterResolved = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    var after = afterResolved.clip ? serializeTrackItem(afterResolved.clip, args.trackIndex, args.clipIndex) : null;

    var endDelta = (after && before && after.endSeconds !== null && before.endSeconds !== null)
      ? (after.endSeconds - before.endSeconds)
      : null;

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        trackType: args.trackType,
        trackIndex: args.trackIndex,
        clipIndex: args.clipIndex,
        requestedOffsetSeconds: args.offsetSeconds,
        formUsed: formUsed,
        attempts: attempts,
        before: before,
        after: after,
        endSecondsDelta: endDelta,
        verified: endDelta !== null && Math.abs(endDelta - args.offsetSeconds) < 0.5,
        note: "verified compares the clip's own end-time shift against the requested offset within half a second — roll's exact per-neighbor semantics are unconfirmed on this build (see PREMIERE_API_NOTES.md)."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
