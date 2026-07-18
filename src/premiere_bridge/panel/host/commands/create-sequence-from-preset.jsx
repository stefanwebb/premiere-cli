// Command: create-sequence-from-preset → ppb_createSequenceFromPreset
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, getSequenceFps, ...) are already defined there.
//
// Sibling of create-sequence.jsx, which bundles its own fixed 4K/25fps
// .sqpreset — this command is the caller-supplied-preset counterpart per
// leancoderkavy's advanced.ts create_sequence_from_preset tool
// (app.project.createNewSequenceFromPreset did not exist on our build per
// PREMIERE_API_NOTES.md — the QE path `qe.project.newSequence(name,
// presetPath)` create-sequence.jsx already proved out is reused here with
// an arbitrary presetPath instead of the bundled one).
//
// Unlike create-sequence, there is no --bin argument — the new sequence
// lands wherever qe.project.newSequence() puts it (bin placement was not
// part of the reference tool's own scope either). Duplicate-name checking
// is at the project root only, since there's no bin scope to check within.
function ppb_createSequenceFromPreset(argsJson) {
  try {
    var args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
    }

    if (!args.name || typeof args.name !== "string") {
      return JSON.stringify({ ok: false, error: "name is required" });
    }
    if (!args.presetPath || typeof args.presetPath !== "string") {
      return JSON.stringify({ ok: false, error: "presetPath is required" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    for (var k = 0; k < app.project.rootItem.children.numItems; k++) {
      var existing = app.project.rootItem.children[k];
      if (existing.name === args.name && existing.type === ProjectItemType.SEQUENCE) {
        return JSON.stringify({ ok: false, error: "sequence \"" + args.name + "\" already exists at the project root" });
      }
    }

    var presetFile = new File(args.presetPath);
    if (!presetFile.exists) {
      return JSON.stringify({ ok: false, error: "preset file not found: " + presetFile.fsName });
    }

    try {
      ensureQEEnabled();
      qe.project.newSequence(args.name, presetFile.fsName);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qe.project.newSequence failed: " + e.toString() });
    }

    var newSequence = findSequenceByName(args.name);
    if (!newSequence) {
      return JSON.stringify({ ok: false, error: "sequence creation failed: no sequence found after qe.project.newSequence" });
    }

    var width = null;
    var height = null;
    var fps = null;
    try {
      var settings = newSequence.getSettings();
      width = settings.videoFrameWidth;
      height = settings.videoFrameHeight;
      fps = getSequenceFps(newSequence);
    } catch (e) {
      width = null;
      height = null;
      fps = null;
    }

    return JSON.stringify({
      ok: true,
      result: {
        name: newSequence.name,
        sequenceID: newSequence.sequenceID,
        presetPath: presetFile.fsName,
        width: width,
        height: height,
        fps: fps
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
