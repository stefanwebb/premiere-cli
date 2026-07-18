// Command: auto-reframe-sequence → ppb_autoReframeSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// PREMIERE_API_NOTES.md's Sequences table documents the 5-arg form:
// `seq.autoReframeSequence(num, den, motionPreset, newName, nestBool)`
// ("2020+ only") — that is what this command calls. This differs from
// leancoderkavy's own advanced.ts auto_reframe_sequence tool, which instead
// calls a 3-arg `seq.autoReframeSequence(targetWidth, targetHeight, nestBool)`
// with no motionPreset/newName. The 5-arg form is used here per the task
// spec and PREMIERE_API_NOTES.md; numerator/denominator are taken to be an
// ASPECT RATIO (e.g. 9/16 for vertical), not pixel dimensions — UNCONFIRMED
// against this build (no live test performed).
//
// Unlike createSubsequence/clone(), autoReframeSequence takes the new
// sequence's name directly as an argument — no post-hoc rename step is
// needed, but the new sequence is still located by a fresh
// findSequenceByName() call afterward rather than trusting the call's own
// (undocumented) return value.
function ppb_autoReframeSequence(argsJson) {
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
    if (typeof args.numerator !== "number" || args.numerator <= 0) {
      return JSON.stringify({ ok: false, error: "numerator must be a positive number" });
    }
    if (typeof args.denominator !== "number" || args.denominator <= 0) {
      return JSON.stringify({ ok: false, error: "denominator must be a positive number" });
    }
    var validPresets = { slower: true, "default": true, faster: true };
    if (!args.motionPreset || !validPresets[args.motionPreset]) {
      return JSON.stringify({ ok: false, error: "motionPreset must be one of slower, default, faster" });
    }
    if (!args.newName || typeof args.newName !== "string") {
      return JSON.stringify({ ok: false, error: "newName is required" });
    }
    if (typeof args.nest !== "boolean") {
      return JSON.stringify({ ok: false, error: "nest (boolean) is required" });
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

    var numSequencesBefore = app.project.sequences.numSequences;

    var callError = null;
    try {
      seq.autoReframeSequence(args.numerator, args.denominator, args.motionPreset, args.newName, args.nest);
    } catch (e) {
      callError = e.toString();
    }

    var numSequencesAfter = app.project.sequences.numSequences;

    if (callError !== null) {
      return JSON.stringify({
        ok: false,
        error: "seq.autoReframeSequence() failed: " + callError,
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter
      });
    }

    var newSeq = findSequenceByName(args.newName);
    if (!newSeq) {
      return JSON.stringify({
        ok: false,
        error: "autoReframeSequence() did not throw, but no sequence named \"" + args.newName + "\" was found afterward",
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter
      });
    }

    var newWidth = null;
    var newHeight = null;
    try {
      var s = newSeq.getSettings();
      newWidth = s.videoFrameWidth;
      newHeight = s.videoFrameHeight;
    } catch (e) {
      newWidth = null;
      newHeight = null;
    }

    return JSON.stringify({
      ok: true,
      result: {
        sourceSequenceName: seq.name,
        numerator: args.numerator,
        denominator: args.denominator,
        motionPreset: args.motionPreset,
        nest: args.nest,
        numSequencesBefore: numSequencesBefore,
        numSequencesAfter: numSequencesAfter,
        newSequenceName: newSeq.name,
        newSequenceID: newSeq.sequenceID,
        newWidth: newWidth,
        newHeight: newHeight,
        note: "numerator/denominator are treated as an aspect ratio per PREMIERE_API_NOTES.md's 5-arg signature — UNCONFIRMED against this build; newWidth/newHeight are reported so a caller can verify the actual result"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
