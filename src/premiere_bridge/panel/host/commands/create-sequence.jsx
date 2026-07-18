// Command: create-sequence → ppb_createSequence
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// Sequence creation without the interactive "New Sequence" dialog uses the
// undocumented QE (Quality Engineering) DOM, not the standard app.project
// DOM: app.project.createNewSequence() pops the dialog regardless of its
// placeholderID argument, and app.project.importSequencePreset() does not
// exist at all on this Premiere Pro version. qe.project.newSequence(name,
// presetPath) creates the sequence directly from a .sqpreset file with no
// dialog, but returns a QE-DOM object with a different API surface — the
// standard Sequence object (needed for moveBin/getSettings/setSettings) is
// re-fetched from app.project.sequences by name afterward.

// The bundled preset is 4K/25fps; requests matching those values skip the
// getSettings()/setSettings() override step entirely (the preset already
// has the right settings, including Rec.709 color space).
var DEFAULT_FPS = 25;
var DEFAULT_WIDTH = 3840;
var DEFAULT_HEIGHT = 2160;

function ppb_createSequence(argsJson) {
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
    if (typeof args.bin !== "string") {
      return JSON.stringify({ ok: false, error: "bin is required" });
    }
    if (typeof args.fps !== "number" || args.fps <= 0) {
      return JSON.stringify({ ok: false, error: "fps must be a positive number" });
    }
    if (typeof args.width !== "number" || args.width <= 0 || Math.floor(args.width) !== args.width) {
      return JSON.stringify({ ok: false, error: "width must be a positive integer" });
    }
    if (typeof args.height !== "number" || args.height <= 0 || Math.floor(args.height) !== args.height) {
      return JSON.stringify({ ok: false, error: "height must be a positive integer" });
    }

    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    // Walk (and create, if missing) the bin path.
    var binSegments = args.bin.split("/").filter(function (s) { return s.length > 0; });
    var currentBin = app.project.rootItem;

    for (var i = 0; i < binSegments.length; i++) {
      var segment = binSegments[i];
      var found = null;

      for (var j = 0; j < currentBin.children.numItems; j++) {
        var child = currentBin.children[j];
        if (child.name === segment && child.type === ProjectItemType.BIN) {
          found = child;
          break;
        }
      }

      if (!found) {
        found = currentBin.createBin(segment);
      }

      currentBin = found;
    }

    // Duplicate check — before any mutation past bin creation.
    for (var k = 0; k < currentBin.children.numItems; k++) {
      var existing = currentBin.children[k];
      if (existing.name === args.name && existing.type === ProjectItemType.SEQUENCE) {
        return JSON.stringify({
          ok: false,
          error: "sequence \"" + args.name + "\" already exists in bin \"" + args.bin + "\""
        });
      }
    }

    if (typeof args.pluginDir !== "string" || args.pluginDir.length === 0) {
      return JSON.stringify({ ok: false, error: "pluginDir was not provided by the panel" });
    }

    var presetFile = new File(args.pluginDir + "/host/presets/default-4k-25fps.sqpreset");
    if (!presetFile.exists) {
      return JSON.stringify({ ok: false, error: "sequence preset file not found: " + presetFile.fsName });
    }

    try {
      ensureQEEnabled();
      qe.project.newSequence(args.name, presetFile.fsName);
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qe.project.newSequence failed: " + e.toString() });
    }

    // qe.project.newSequence returns a QE-DOM object, not a standard
    // Sequence — re-fetch the real one by name to use normal DOM methods.
    var newSequence = null;
    for (var s = 0; s < app.project.sequences.numSequences; s++) {
      if (app.project.sequences[s].name === args.name) {
        newSequence = app.project.sequences[s];
        break;
      }
    }

    if (!newSequence) {
      return JSON.stringify({ ok: false, error: "sequence creation failed: no sequence found after qe.project.newSequence" });
    }

    var settingsApplied = [];
    var settingsFailed = {};

    try {
      newSequence.projectItem.moveBin(currentBin);
    } catch (e) {
      settingsFailed.bin = e.toString();
    }

    var matchesDefaults = (args.fps === DEFAULT_FPS && args.width === DEFAULT_WIDTH && args.height === DEFAULT_HEIGHT);

    if (matchesDefaults) {
      // The bundled preset already is 4K/25fps — nothing further to apply.
      settingsApplied.push("fps");
      settingsApplied.push("resolution");
    } else {
      try {
        var fpsSettings = newSequence.getSettings();
        fpsSettings.videoFrameRate = TICKS_PER_SECOND / args.fps;
        newSequence.setSettings(fpsSettings);
        settingsApplied.push("fps");
      } catch (e) {
        settingsFailed.fps = e.toString();
      }

      try {
        var resSettings = newSequence.getSettings();
        resSettings.videoFrameWidth = args.width;
        resSettings.videoFrameHeight = args.height;
        newSequence.setSettings(resSettings);
        settingsApplied.push("resolution");
      } catch (e) {
        settingsFailed.resolution = e.toString();
      }
    }

    return JSON.stringify({
      ok: true,
      result: {
        name: newSequence.name,
        bin: args.bin,
        sequenceID: newSequence.sequenceID,
        settingsApplied: settingsApplied,
        settingsFailed: settingsFailed,
        colorSpace: "rec709 (from bundled sequence preset)"
      }
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
