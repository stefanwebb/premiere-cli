// Command: set-sequence-settings → ppb_setSequenceSettings
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// getSequenceFps, TICKS_PER_SECOND, ...) are already defined there.
//
// MERGES SEVEN reference tools into one command: leancoderkavy's
// sequence.ts set_sequence_settings (generic width/height) PLUS utility.ts's
// set_sequence_frame_rate, set_sequence_resolution, set_sequence_audio_settings
// (sample rate only — channel type is not exposed here), set_sequence_pixel_
// aspect_ratio (taken here as a numerator/denominator pair rather than a
// single ratio float, so callers don't have to pre-divide), set_sequence_
// field_type, and set_sequence_display_format (video format only). Any
// combination of frameRate/width/height/audioSampleRate/(parNumerator+
// parDenominator)/fieldType/displayFormat may be given; at least one is
// required.
//
// ⚠️ setSettings() UNRELIABILITY (PREMIERE_API_NOTES.md's "Settings write"
// line, and create-sequence.jsx's own comment): [leancoderkavy]/[ayushozha]
// claim getSettings()→mutate→setSettings() works, [hetpatel] says settings
// "cannot be changed after creation", and our own live create-sequence
// testing found non-default fps/resolution doesn't reliably apply. This
// command does NOT trust setSettings() not throwing as success — each
// requested field is individually verified by a FRESH getSettings() call
// after the write, exactly like create-sequence's settingsApplied/
// settingsFailed pattern, but per-field here (result.fields[name].applied).
function ppbSeqSettings_getFps(seq) {
  try {
    return getSequenceFps(seq);
  } catch (e) {
    return null;
  }
}

function ppb_setSequenceSettings(argsJson) {
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

    var seq;
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

    var hasFrameRate = typeof args.frameRate === "number";
    var hasWidth = typeof args.width === "number";
    var hasHeight = typeof args.height === "number";
    var hasAudioSampleRate = typeof args.audioSampleRate === "number";
    var hasParNum = typeof args.parNumerator === "number";
    var hasParDen = typeof args.parDenominator === "number";
    var hasFieldType = typeof args.fieldType === "number";
    var hasDisplayFormat = typeof args.displayFormat === "number";

    if (hasParNum !== hasParDen) {
      return JSON.stringify({ ok: false, error: "parNumerator and parDenominator must be given together" });
    }
    var hasPar = hasParNum && hasParDen;

    if (!hasFrameRate && !hasWidth && !hasHeight && !hasAudioSampleRate && !hasPar && !hasFieldType && !hasDisplayFormat) {
      return JSON.stringify({
        ok: false,
        error: "at least one of frameRate, width, height, audioSampleRate, parNumerator+parDenominator, fieldType, displayFormat is required"
      });
    }

    var applied = [];
    var failed = {};
    var fields = {};

    function applyOne(name, mutateFn, readFn, verifyFn) {
      var previousValue = null;
      try { previousValue = readFn(); } catch (e) { previousValue = null; }

      try {
        var settings = seq.getSettings();
        mutateFn(settings);
        seq.setSettings(settings);
      } catch (e) {
        failed[name] = "setSettings() threw: " + e.toString();
        fields[name] = { previousValue: previousValue, newValue: null, applied: false };
        return;
      }

      var newValue = null;
      try { newValue = readFn(); } catch (e) { newValue = null; }

      var ok = false;
      try { ok = verifyFn(newValue); } catch (e) { ok = false; }

      fields[name] = { previousValue: previousValue, newValue: newValue, applied: ok };
      if (ok) {
        applied.push(name);
      } else {
        failed[name] = "setSettings() did not throw, but a fresh getSettings() read-back does not match the requested value — matches the documented setSettings() unreliability on this build";
      }
    }

    if (hasFrameRate) {
      applyOne(
        "frameRate",
        function (s) { s.videoFrameRate = TICKS_PER_SECOND / args.frameRate; },
        function () { return ppbSeqSettings_getFps(seq); },
        function (v) { return v !== null && Math.abs(v - args.frameRate) < 0.05; }
      );
    }
    if (hasWidth) {
      applyOne(
        "width",
        function (s) { s.videoFrameWidth = args.width; },
        function () { return seq.getSettings().videoFrameWidth; },
        function (v) { return v === args.width; }
      );
    }
    if (hasHeight) {
      applyOne(
        "height",
        function (s) { s.videoFrameHeight = args.height; },
        function () { return seq.getSettings().videoFrameHeight; },
        function (v) { return v === args.height; }
      );
    }
    if (hasAudioSampleRate) {
      applyOne(
        "audioSampleRate",
        function (s) { s.audioSampleRate = args.audioSampleRate; },
        function () { return seq.getSettings().audioSampleRate; },
        function (v) { return v === args.audioSampleRate; }
      );
    }
    if (hasPar) {
      var ratio = args.parNumerator / args.parDenominator;
      applyOne(
        "pixelAspectRatio",
        function (s) { s.videoPixelAspectRatio = ratio; },
        function () { return seq.getSettings().videoPixelAspectRatio; },
        function (v) { return v !== null && Math.abs(v - ratio) < 0.001; }
      );
    }
    if (hasFieldType) {
      applyOne(
        "fieldType",
        function (s) { s.videoFieldType = args.fieldType; },
        function () { return seq.getSettings().videoFieldType; },
        function (v) { return v === args.fieldType; }
      );
    }
    if (hasDisplayFormat) {
      applyOne(
        "displayFormat",
        function (s) { s.videoDisplayFormat = args.displayFormat; },
        function () { return seq.getSettings().videoDisplayFormat; },
        function (v) { return v === args.displayFormat; }
      );
    }

    return JSON.stringify({
      ok: true,
      result: {
        sequenceName: seq.name,
        applied: applied,
        failed: failed,
        fields: fields,
        note: "merges 7 reference tools (set_sequence_settings + utility.ts's 6 individual setters) into one command — see the file header comment. Undo is non-functional on this build; previousValue per field is the only restoration path."
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
