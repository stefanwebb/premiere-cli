// Command: slip-edit → ppb_slipEdit
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ensureQEEnabled, activateSequenceForQE, resolveTimelineClip,
// resolveQeClip, serializeTrackItem, TICKS_PER_SECOND, ...) are already
// defined there.
//
// Slips the addressed clip's source in/out points forward/backward
// WITHOUT moving it on the timeline (its start/end stay fixed; which
// portion of the source media it shows changes). Ported from
// leancoderkavy's premiere-pro-mcp `slip_edit` tool (advanced.ts:
// `qeClip.slip(offsetTicksString)`), whose signature is UNCONFIRMED on
// this build (`slip` is on our own reflect list per QE_DOM_NOTES.md /
// PREMIERE_API_NOTES.md, but never live-called) — every plausible
// argument form is tried in turn (ticks string, then a raw seconds
// number, then a Time object), recording an `attempts` array, and
// success is judged by an actual before/after shift in the clip's own
// inPoint matching the requested offset, never by whether the call
// merely avoided throwing. Positive offsetSeconds slips forward in the
// source, negative slips backward.

function ppbSlipEdit_offsetForms(offsetSeconds) {
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

function ppb_slipEdit(argsJson) {
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

    if (typeof qeClip.slip !== "function") {
      return JSON.stringify({ ok: false, error: "qeClip.slip is not available on this Premiere build" });
    }

    var attempts = [];
    var forms = ppbSlipEdit_offsetForms(args.offsetSeconds);
    var succeeded = false;
    var formUsed = null;
    for (var i = 0; i < forms.length && !succeeded; i++) {
      try {
        qeClip.slip(forms[i].value);
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
        error: "qeClip.slip() failed with every argument form tried",
        attempts: attempts
      });
    }

    var afterResolved = resolveTimelineClip(seq, args.trackType, args.trackIndex, args.clipIndex);
    var after = afterResolved.clip ? serializeTrackItem(afterResolved.clip, args.trackIndex, args.clipIndex) : null;

    var inPointDelta = (after && before && after.inPointSeconds !== null && before.inPointSeconds !== null)
      ? (after.inPointSeconds - before.inPointSeconds)
      : null;
    var startDelta = (after && before && after.startSeconds !== null && before.startSeconds !== null)
      ? (after.startSeconds - before.startSeconds)
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
        inPointSecondsDelta: inPointDelta,
        startSecondsDelta: startDelta,
        verified: inPointDelta !== null && Math.abs(inPointDelta - args.offsetSeconds) < 0.5 &&
          (startDelta === null || Math.abs(startDelta) < 0.5),
        note: "verified checks that inPoint shifted by roughly the requested offset while start stayed roughly fixed — slip's exact semantics are unconfirmed on this build (see PREMIERE_API_NOTES.md)."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
