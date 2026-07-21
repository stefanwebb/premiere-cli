// Command: export-frame → ppb_exportFrame
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findBundledPresetByRelativePath, trySetSequenceRange, getSequenceFps,
// timecodeToSeconds, ...) are already defined there.

// A bundled still-image preset for the AME single-frame export below —
// confirmed present on this machine's Premiere Pro 2026 install at this
// relative path; re-verify after a Premiere version upgrade, same caveat
// as extract-audio-track's FORMAT_PRESET_RELATIVE_PATHS. "Match Source"
// means the preset inherits the sequence's own frame size, so no
// width/height override is needed when using it.
var STILL_IMAGE_PRESET_RELATIVE_PATH =
  "Contents/MediaIO/systempresets/3F3F3F3F_504E4720/PNG Sequence (Match Source).epr";

// Premiere treats a still-image preset as a one-frame image *sequence*,
// appending a frame number to the base name ("frame.png" → "frame0.png",
// confirmed live; padding may vary by preset/duration). Finds whichever
// variant was actually written and renames it to the exact requested path
// so callers reliably get the file where they asked for it.
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
//
// qe.project.getActiveSequence().exportFramePNG was tried first in an
// earlier version of this command (guessing at its version-dependent arg
// order per PREMIERE_API_NOTES.md), judging success only by whether a file
// was produced. That check is NOT sufficient: confirmed live 2026-07-20
// that on this Premiere build, exportFramePNG ignores its position
// argument in every arg-order variant tried (ticksString, Time object,
// output-path-as-position, ticks-then-path, path-then-ticks) and always
// exports whatever frame is currently rendered in the Program Monitor,
// regardless of the requested timecode — while still writing a real file
// and returning normally, so the file-existence check reported false
// positives. Two exports requested 30 seconds apart came back
// pixel-identical. Neither seq.setPlayerPosition() (standard DOM) nor
// qeSequence.setCTI() (QE DOM) changed this.
//
// This command now exports exclusively via Adobe Media Encoder's
// exportAsMediaDirect() — the same documented, blocking mechanism
// ppb_extractAudioTrack already uses successfully — narrowing the
// sequence's in/out points to exactly one frame around the target
// timecode. Confirmed live to produce genuinely different, timecode-
// correct frames (verified via pixel diff, not just file existence).
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

    if (app.project.activeSequence !== seq) {
      app.project.activeSequence = seq;
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
      // best-effort only — reported in the result, not required for export
    }

    var result = {
      sequenceName: seq.name,
      timecode: args.timecode,
      timeSeconds: timeSeconds,
      outputPath: args.outputPath,
      width: width,
      height: height
    };

    // Clear any stale leftover from an earlier failed run — the exact
    // requested path plus every known frame-numbered variant Premiere
    // might write it under (see locateAndNormalizeExportedFrame) — so a
    // leftover file's mere existence can't be mistaken for this run's
    // output.
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

    var amePresetPath = findBundledPresetByRelativePath(STILL_IMAGE_PRESET_RELATIVE_PATH);
    if (!amePresetPath) {
      return JSON.stringify({
        ok: false,
        error: "no bundled still-image preset found for the Media Encoder export"
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
        error: "Media Encoder export failed" + (ameError ? ": " + ameError : " (no file produced)")
      });
    }

    result.method = "ame";
    result.presetPath = amePresetPath;
    result.fileSizeBytes = ameProducedFile.length;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
