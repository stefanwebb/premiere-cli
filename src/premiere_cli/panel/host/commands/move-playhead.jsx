// Command: move-playhead → ppb_movePlayhead
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, getSequenceFps, timecodeToSeconds, ...) are already
// defined there.

// Moves the given (or active) sequence's playhead to a target time, given
// as either a "MM:SS:FF" timecode or a raw seconds value. Reuses the exact
// playhead-move pattern from ppb_exportFrame (host/commands/export-frame.jsx)
// — ticksString first, a Time-object fallback, collecting a positionAttempts
// array of {form, success, error?} — which is live-confirmed working on
// this Premiere build. Unlike export-frame, there is nothing to restore
// afterward: moving the playhead IS the point of this command.
function ppb_movePlayhead(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    var hasTimecode = args.timecode !== undefined && args.timecode !== null;
    var hasSeconds = args.seconds !== undefined && args.seconds !== null;

    if (hasTimecode === hasSeconds) {
      return JSON.stringify({ ok: false, error: "exactly one of timecode or seconds must be provided" });
    }

    if (hasTimecode) {
      var timecodeRe = /^\d{2,3}:\d{2}:\d{2}$/;
      if (typeof args.timecode !== "string" || !timecodeRe.test(args.timecode)) {
        return JSON.stringify({ ok: false, error: "timecode must be a \"MM:SS:FF\" string" });
      }
    } else {
      if (typeof args.seconds !== "number" || isNaN(args.seconds) || args.seconds < 0) {
        return JSON.stringify({ ok: false, error: "seconds must be a non-negative number" });
      }
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

    // Moving the playhead implies the user wants to see it — make the
    // resolved sequence the active one if it isn't already (same approach
    // as ppb_removeTrackIntervals / ppb_exportFrame). No QE DOM needed here.
    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
    }

    var timeSeconds;
    if (hasTimecode) {
      var fps = getSequenceFps(seq);
      timeSeconds = timecodeToSeconds(args.timecode, fps);
    } else {
      timeSeconds = args.seconds;
    }

    var positionAttempts = [];
    var ticksString = String(Math.round(timeSeconds * TICKS_PER_SECOND));
    var timeObj = null;
    try {
      timeObj = new Time();
      timeObj.seconds = timeSeconds;
    } catch (e) {
      timeObj = null;
    }

    var positionSet = false;
    try {
      seq.setPlayerPosition(ticksString);
      positionAttempts.push({ form: "ticksString", success: true });
      positionSet = true;
    } catch (e) {
      positionAttempts.push({ form: "ticksString", success: false, error: e.toString() });
    }
    if (!positionSet && timeObj !== null) {
      try {
        seq.setPlayerPosition(timeObj);
        positionAttempts.push({ form: "TimeObject", success: true });
        positionSet = true;
      } catch (e) {
        positionAttempts.push({ form: "TimeObject", success: false, error: e.toString() });
      }
    }

    if (!positionSet) {
      return JSON.stringify({
        ok: false,
        error: "could not move the playhead to the requested time with any known argument form (ticks string, Time object)",
        attempts: positionAttempts
      });
    }

    var playheadSeconds = null;
    try {
      var currentPosition = seq.getPlayerPosition();
      if (currentPosition !== null && typeof currentPosition !== "undefined") {
        if (typeof currentPosition.seconds === "number") {
          playheadSeconds = currentPosition.seconds;
        } else {
          playheadSeconds = Number(currentPosition.ticks) / TICKS_PER_SECOND;
        }
      }
    } catch (e) {
      playheadSeconds = null;
    }

    var result = {
      sequenceName: seq.name,
      requestedSeconds: timeSeconds,
      playheadSeconds: playheadSeconds,
      attempts: positionAttempts
    };
    if (hasTimecode) {
      result.timecode = args.timecode;
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
