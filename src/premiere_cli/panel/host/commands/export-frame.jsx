// Command: export-frame → ppb_exportFrame
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, findBundledPresetByRelativePath, trySetSequenceRange,
// getSequenceFps, timecodeToSeconds, ...) are already defined there.

// A bundled still-image preset for the ppb_exportFrame AME fallback (see
// below) — confirmed present on this machine's Premiere Pro 2026 install
// at this relative path; re-verify after a Premiere version upgrade, same
// caveat as extract-audio-track's FORMAT_PRESET_RELATIVE_PATHS. "Match
// Source" means the preset inherits the sequence's own frame size, so no
// width/height override is needed when using it.
var STILL_IMAGE_PRESET_RELATIVE_PATH =
  "Contents/MediaIO/systempresets/3F3F3F3F_504E4720/PNG Sequence (Match Source).epr";

// The QE exportFramePNG call (see ppb_exportFrame) and the AME
// image-sequence export below can both write under a name other than the
// exact path requested — QE appends ".png" even to an already-.png-
// suffixed path ("frame.png" → "frame.png.png", confirmed live), and
// Premiere treats a still-image preset as a one-frame image *sequence*,
// appending a frame number to the base name ("frame.png" → "frame0.png",
// confirmed live; padding may vary by preset/duration). Finds whichever
// variant was actually written and renames it to the exact requested
// path so callers reliably get the file where they asked for it.
//
// Known variants are checked DIRECTLY by path, not found via a directory
// scan: enumerating the parent directory returns an empty list on this
// machine for some directories (e.g. /tmp — same macOS TCC/sandboxing
// behavior already documented for /Applications in
// findBundledPresetByRelativePath's notes in host/index.jsx) even though
// the files themselves are readable at their exact paths. A directory
// scan runs only as a last resort, for variant names not in the known
// list.
function locateAndNormalizeExportedFrame(outputPath) {
  var exact = new File(outputPath);
  if (exact.exists && exact.length > 0) {
    return exact;
  }

  var fullName = decodeURI(exact.name);
  var dot = fullName.lastIndexOf(".");
  var base = dot === -1 ? fullName : fullName.substring(0, dot);
  var ext = dot === -1 ? "" : fullName.substring(dot);
  var parentPath = exact.path;

  function normalize(produced) {
    if (produced.length <= 0) {
      return null;
    }
    try {
      if (produced.fsName !== exact.fsName) {
        produced.rename(fullName);
      }
    } catch (e) {
      // rename best-effort — still report the file under whatever name it has
      return produced;
    }
    return exact.exists ? exact : produced;
  }

  var knownVariants = [
    outputPath + ".png",                      // QE double-extension quirk
    parentPath + "/" + base + "0" + ext,      // AME frame-number suffix
    parentPath + "/" + base + "00" + ext,
    parentPath + "/" + base + "000" + ext,
    parentPath + "/" + base + "0000" + ext
  ];
  for (var v = 0; v < knownVariants.length; v++) {
    var candidate = new File(knownVariants[v]);
    if (candidate.exists && candidate.length > 0) {
      return normalize(candidate);
    }
  }

  // Last resort: scan the parent directory (returns nothing at all in
  // enumeration-blocked directories — see comment above).
  var dir = exact.parent;
  if (!dir || !dir.exists) {
    return null;
  }

  var matches = dir.getFiles(function (item) {
    if (item instanceof Folder) {
      return false;
    }
    var name = decodeURI(item.name);
    if (name.indexOf(base) !== 0) {
      return false;
    }
    var lowerExt = ext.toLowerCase();
    return lowerExt === "" || name.toLowerCase().substring(name.length - lowerExt.length) === lowerExt;
  });

  if (!matches || matches.length === 0) {
    return null;
  }

  return normalize(matches[0]);
}

// Exports a single frame of a sequence, at a given timecode, to a PNG file.
// qeSeq.exportFramePNG's argument order is version-dependent (per
// PREMIERE_API_NOTES.md) and can silently write nothing on some builds —
// this brute-forces a short list of plausible signatures and judges success
// only by checking the filesystem for a real output file afterward, never
// by trusting the call's own return value (same pattern as
// remove-track-intervals' rippleDelete()/remove() guessing).
function ppb_exportFrame(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.outputPath || typeof args.outputPath !== "string") {
      return JSON.stringify({ ok: false, error: "outputPath is required" });
    }
    var timecodeRe = /^\d{2,3}:\d{2}:\d{2}$/;
    if (!args.timecode || typeof args.timecode !== "string" || !timecodeRe.test(args.timecode)) {
      return JSON.stringify({ ok: false, error: "timecode must be a \"MM:SS:FF\" string" });
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

    // QE DOM only ever operates on the active sequence tab — switch to it
    // rather than erroring if the resolved sequence isn't already active
    // (same approach as ppb_removeTrackIntervals).
    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
    }

    try {
      ensureQEEnabled();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e.toString() });
    }
    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }
    var qeSequence = qe.project.getActiveSequence();
    if (!qeSequence) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() returned nothing after activating the sequence" });
    }

    var fps = getSequenceFps(seq);
    var timeSeconds = timecodeToSeconds(args.timecode, fps);

    var width = null;
    var height = null;
    try {
      var settings = seq.getSettings();
      width = settings.videoFrameWidth;
      height = settings.videoFrameHeight;
    } catch (e) {
      // best-effort only — width/height-based attempts below are simply skipped if unreadable
    }

    // --- Snapshot playhead position, to restore afterward regardless of outcome ---
    var originalPosition = null;
    try {
      originalPosition = seq.getPlayerPosition();
    } catch (e) {
      originalPosition = null;
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

    var result = {
      sequenceName: seq.name,
      timecode: args.timecode,
      timeSeconds: timeSeconds,
      outputPath: args.outputPath,
      width: width,
      height: height
    };

    try {
      if (!positionSet) {
        return JSON.stringify({
          ok: false,
          error: "could not move the playhead to the requested timecode with any known argument form (ticks string, Time object)",
          attempts: positionAttempts
        });
      }

      // Clear any stale leftovers from an earlier failed run — the exact
      // requested path plus every known name variant Premiere might have
      // written it under (see locateAndNormalizeExportedFrame) — so a
      // leftover file's mere existence can't be mistaken for this run's
      // output. Loops because multiple variants can coexist (e.g. one QE
      // double-extension file AND one AME frame-numbered file).
      for (var staleRound = 0; staleRound < 8; staleRound++) {
        var stale = locateAndNormalizeExportedFrame(args.outputPath);
        if (stale === null) {
          break;
        }
        try {
          stale.remove();
        } catch (e) {
          // best-effort — a failed cleanup doesn't block the export attempt
          break;
        }
      }

      // --- Path 1: QE DOM's exportFramePNG. Version-inconsistent arg
      // order (per PREMIERE_API_NOTES.md) and confirmed live to sometimes
      // return false / write nothing regardless of a syntactically
      // correct call — verify by scanning the filesystem afterward, never
      // by trusting the call's return value.
      var guesses = [];
      guesses.push({ args: [args.outputPath], call: [args.outputPath] });
      if (width !== null && height !== null) {
        guesses.push({ args: [args.outputPath, String(width), String(height)], call: [args.outputPath, String(width), String(height)] });
      }
      // Confirmed live on this Premiere build: passing the output path as
      // BOTH arguments succeeds where sensible width/height strings do
      // not — an undocumented quirk of this exportFramePNG build, kept as
      // a guess rather than relied on, since other builds may differ.
      guesses.push({ args: [args.outputPath, args.outputPath], call: [args.outputPath, args.outputPath] });
      if (timeObj !== null) {
        guesses.push({ args: ["<Time seconds=" + timeSeconds + ">", args.outputPath], call: [timeObj, args.outputPath] });
      }
      guesses.push({ args: [ticksString, args.outputPath], call: [ticksString, args.outputPath] });

      var attempts = [];
      var succeededWithArgs = null;
      var qeProducedFile = null;

      for (var g = 0; g < guesses.length && succeededWithArgs === null; g++) {
        var guess = guesses[g];
        try {
          qeSequence.exportFramePNG.apply(qeSequence, guess.call);
        } catch (e) {
          attempts.push({ args: guess.args, success: false, error: e.toString() });
          continue;
        }

        var producedFile = locateAndNormalizeExportedFrame(args.outputPath);
        if (producedFile !== null) {
          attempts.push({ args: guess.args, success: true });
          succeededWithArgs = guess.args;
          qeProducedFile = producedFile;
        } else {
          attempts.push({ args: guess.args, success: false, error: "no file produced" });
        }
      }

      if (succeededWithArgs !== null) {
        result.method = "qe";
        result.attempts = attempts;
        result.succeededWithArgs = succeededWithArgs;
        result.fileSizeBytes = qeProducedFile.length;
        return JSON.stringify({ ok: true, result: result });
      }

      // --- Path 2: every QE guess failed — fall back to a one-frame
      // export through Adobe Media Encoder via the standard DOM's
      // exportAsMediaDirect(), the same documented, blocking mechanism
      // ppb_extractAudioTrack already uses successfully. Narrows the
      // sequence's in/out points to exactly one frame (using the
      // sequence's own frame duration, seq.timebase) around the target
      // timecode, then restores the original in/out points afterward.
      var amePresetPath = findBundledPresetByRelativePath(STILL_IMAGE_PRESET_RELATIVE_PATH);
      if (!amePresetPath) {
        return JSON.stringify({
          ok: false,
          error: "exportFramePNG failed with all known arg-order variants, and no bundled still-image preset was found for the Media Encoder fallback",
          attempts: attempts
        });
      }

      var originalInPoint = null;
      var originalOutPoint = null;
      try {
        originalInPoint = seq.getInPoint();
        originalOutPoint = seq.getOutPoint();
      } catch (e) {
        // best-effort only — if these can't be read, we simply won't restore them
      }

      var frameDurationSeconds = 1 / fps;
      var ameProducedFile = null;
      var ameError = null;

      try {
        var rangeOutcome = trySetSequenceRange(seq, timeSeconds, timeSeconds + frameDurationSeconds);
        if (!rangeOutcome.ok) {
          ameError = "could not set sequence in/out points with any known argument form (seconds, ticks string, Time object)";
        } else {
          try {
            seq.exportAsMediaDirect(args.outputPath, amePresetPath, 1 /* ENCODE_IN_TO_OUT */);
          } catch (e) {
            ameError = "exportAsMediaDirect failed: " + e.toString();
          }
        }
      } finally {
        if (originalInPoint !== null && originalOutPoint !== null) {
          try {
            trySetSequenceRange(seq, originalInPoint.seconds, originalOutPoint.seconds);
          } catch (e) {
            // best-effort
          }
        }
      }

      if (ameError === null) {
        ameProducedFile = locateAndNormalizeExportedFrame(args.outputPath);
      }

      if (ameProducedFile === null) {
        return JSON.stringify({
          ok: false,
          error: "exportFramePNG failed with all known arg-order variants, and the Media Encoder fallback also failed" +
            (ameError ? ": " + ameError : " (no file produced)"),
          attempts: attempts
        });
      }

      result.method = "ame";
      result.attempts = attempts;
      result.presetPath = amePresetPath;
      result.fileSizeBytes = ameProducedFile.length;

      return JSON.stringify({ ok: true, result: result });
    } finally {
      // Always restore the original playhead position, even if export threw.
      if (originalPosition !== null) {
        try {
          seq.setPlayerPosition(originalPosition.ticks);
        } catch (e) {
          // best-effort — restoration failure doesn't change the command's outcome
        }
      }
    }
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
