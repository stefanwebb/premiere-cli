// Command: extract-audio-track → ppb_extractAudioTrack
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// findBundledPresetByRelativePath, trySetSequenceRange, ...) are already
// defined there.
//
// Extracts part or all of one audio track to a local file, via the
// standard DOM's seq.exportAsMediaDirect() — synchronous, no Adobe Media
// Encoder dependency (unlike app.encoder.encodeSequence, which is
// fire-and-forget with no progress API). Isolates the target track by
// muting every other track, then restores original mute state and
// sequence in/out points afterward regardless of success or failure.

// Audio export presets bundled inside the Premiere Pro app itself — see
// findBundledPresetByRelativePath (host/index.jsx) for how these relative
// paths are resolved. Confirmed present on this machine's Premiere Pro
// 2026 install; re-verify after a Premiere version upgrade.
var FORMAT_PRESET_RELATIVE_PATHS = {
  wav: "Contents/Settings/EncoderPresets/AudioOnly.epr",
  mp3: "Contents/MediaIO/systempresets/3F3F3F3F_4D503320/MP3 256kbps High Quality.epr",
  aac: "Contents/MediaIO/systempresets/4E49434B_41414320/Stereo AAC, 48kHz 256kbps.epr"
};

function ppb_extractAudioTrack(argsJson) {
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
    if (typeof args.audioTrackIndex !== "number" || args.audioTrackIndex < 0 || Math.floor(args.audioTrackIndex) !== args.audioTrackIndex) {
      return JSON.stringify({ ok: false, error: "audioTrackIndex must be a non-negative integer" });
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

    if (args.audioTrackIndex >= seq.audioTracks.numTracks) {
      return JSON.stringify({
        ok: false,
        error: "audioTrackIndex " + args.audioTrackIndex + " is out of range (sequence \"" + seq.name +
          "\" has " + seq.audioTracks.numTracks + " audio track(s))"
      });
    }

    var hasStart = typeof args.startSeconds === "number";
    var hasEnd = typeof args.endSeconds === "number";
    if (hasStart !== hasEnd) {
      return JSON.stringify({ ok: false, error: "startSeconds and endSeconds must be given together, or not at all" });
    }
    var hasRange = hasStart && hasEnd;
    if (hasRange && args.endSeconds <= args.startSeconds) {
      return JSON.stringify({ ok: false, error: "endSeconds must be greater than startSeconds" });
    }

    var presetPath = null;
    var format = null;
    if (args.presetPath && typeof args.presetPath === "string") {
      presetPath = args.presetPath;
    } else {
      format = (args.format && typeof args.format === "string") ? args.format.toLowerCase() : "wav";
      var relativePresetPath = FORMAT_PRESET_RELATIVE_PATHS[format];
      if (!relativePresetPath) {
        return JSON.stringify({
          ok: false,
          error: "unknown format \"" + args.format + "\" — known formats: wav, mp3, aac (or pass presetPath explicitly for any other .epr)"
        });
      }
      presetPath = findBundledPresetByRelativePath(relativePresetPath);
    }

    if (!presetPath) {
      var appPathForError = null;
      try { appPathForError = app.path; } catch (e) { appPathForError = "<unreadable>"; }
      return JSON.stringify({
        ok: false,
        error: "no presetPath given and no bundled preset for format \"" + format + "\" found relative to app.path (" +
          appPathForError + ") — pass presetPath explicitly"
      });
    }
    var presetFile = new File(presetPath);
    if (!presetFile.exists) {
      return JSON.stringify({ ok: false, error: "preset file not found: " + presetPath });
    }

    // --- Snapshot state to restore afterward, whatever happens ---
    var originalAudioMutes = [];
    for (var a = 0; a < seq.audioTracks.numTracks; a++) {
      originalAudioMutes.push(seq.audioTracks[a].isMuted());
    }
    var originalVideoMutes = [];
    for (var v = 0; v < seq.videoTracks.numTracks; v++) {
      originalVideoMutes.push(seq.videoTracks[v].isMuted());
    }
    var originalInPoint = null;
    var originalOutPoint = null;
    try {
      originalInPoint = seq.getInPoint();
      originalOutPoint = seq.getOutPoint();
    } catch (e) {
      // best-effort only — if these can't be read, we simply won't restore them
    }

    var result = {
      sequenceName: seq.name,
      audioTrackIndex: args.audioTrackIndex,
      outputPath: args.outputPath,
      format: format || "custom (explicit presetPath)",
      presetPath: presetPath,
      range: hasRange ? { startSeconds: args.startSeconds, endSeconds: args.endSeconds } : "entire sequence"
    };

    try {
      // Mute every video track — this is an audio-only export.
      for (var v2 = 0; v2 < seq.videoTracks.numTracks; v2++) {
        seq.videoTracks[v2].setMute(1);
      }
      // Mute every audio track except the one being extracted.
      for (var a2 = 0; a2 < seq.audioTracks.numTracks; a2++) {
        seq.audioTracks[a2].setMute(a2 === args.audioTrackIndex ? 0 : 1);
      }

      var workAreaType = 0; // ENCODE_ENTIRE
      if (hasRange) {
        var rangeOutcome = trySetSequenceRange(seq, args.startSeconds, args.endSeconds);
        result.rangeSetAttempts = rangeOutcome.attempts;
        if (!rangeOutcome.ok) {
          throw new Error("could not set sequence in/out points with any known argument form (seconds, ticks string, Time object)");
        }
        workAreaType = 1; // ENCODE_IN_TO_OUT
      }

      seq.exportAsMediaDirect(args.outputPath, presetPath, workAreaType);
    } finally {
      // Always restore original state, even if the export threw.
      for (var v3 = 0; v3 < seq.videoTracks.numTracks; v3++) {
        try { seq.videoTracks[v3].setMute(originalVideoMutes[v3] ? 1 : 0); } catch (e) { /* best-effort */ }
      }
      for (var a3 = 0; a3 < seq.audioTracks.numTracks; a3++) {
        try { seq.audioTracks[a3].setMute(originalAudioMutes[a3] ? 1 : 0); } catch (e) { /* best-effort */ }
      }
      if (hasRange && originalInPoint !== null && originalOutPoint !== null) {
        try { trySetSequenceRange(seq, originalInPoint.seconds, originalOutPoint.seconds); } catch (e) { /* best-effort */ }
      }
    }

    var outFile = new File(args.outputPath);
    if (!outFile.exists) {
      return JSON.stringify({
        ok: false,
        error: "exportAsMediaDirect ran but no file was written to " + args.outputPath +
          " (workAreaType=" + workAreaType + ", preset=" + presetPath + ")"
      });
    }

    result.fileSizeBytes = outFile.length;

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
