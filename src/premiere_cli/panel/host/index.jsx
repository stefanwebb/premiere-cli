// Premiere Bridge — ExtendScript loader and lazy command dispatcher.
//
// This file is the manifest's single <ScriptPath>, evaluated eagerly when
// the panel loads. It defines only the helpers shared by more than one
// command, plus ppb_dispatch() — each command's actual implementation
// lives in host/commands/<command-name>.jsx and is $.evalFile'd into this
// same global context the first time that command is called.
//
// Every ppb_-prefixed command function wraps its body in try/catch and
// always returns a JSON string itself — an uncaught exception here makes
// evalScript's callback receive only the unhelpful literal string
// "EvalScript error." with no detail. ppb_dispatch follows the same rule
// for load/dispatch failures.

var TICKS_PER_SECOND = 254016000000;

// The QE (Quality Engineering) DOM — app.enableQE(); qe.project... — is
// undocumented but required for several operations the standard DOM can't
// do without a dialog (sequence creation from a preset, razor, frame
// export). See host/QE_DOM_NOTES.md and host/PREMIERE_API_NOTES.md.
function ensureQEEnabled() {
  if (typeof qe === "undefined") {
    app.enableQE();
  }
}

function findSequenceByName(name) {
  for (var i = 0; i < app.project.sequences.numSequences; i++) {
    if (app.project.sequences[i].name === name) {
      return app.project.sequences[i];
    }
  }
  return null;
}

// A handful of export presets ship inside the Premiere Pro app bundle
// itself — no need to bundle our own. Paths are relative to the app
// bundle root and resolved via app.path (the running app's own install
// location, always readable) rather than scanning /Applications: a
// directory listing of /Applications from inside the CEP panel returned
// nothing on this machine — likely macOS TCC/sandboxing blocking that
// enumeration even though the specific preset files themselves ARE
// readable.
function findBundledPresetByRelativePath(relativePath) {
  try {
    var appPath = app.path;
    var bundleEnd = appPath.indexOf(".app");
    if (bundleEnd === -1) {
      return null;
    }
    var bundlePath = appPath.substring(0, bundleEnd + 4); // include ".app"
    var presetFile = new File(bundlePath + "/" + relativePath);
    if (presetFile.exists) {
      return presetFile.fsName;
    }
  } catch (e) {
    // fall through — caller reports "no preset found"
  }
  return null;
}

// seq.setInPoint()/setOutPoint() argument type is inconsistent across
// Premiere versions in the wild (plain seconds vs. ticks string vs. Time
// object) — try each form in turn rather than guessing one and failing.
function trySetSequenceRange(seq, startSeconds, endSeconds) {
  var attempts = [];

  function attempt(label, inVal, outVal) {
    try {
      seq.setInPoint(inVal);
      seq.setOutPoint(outVal);
      attempts.push({ form: label, success: true });
      return true;
    } catch (e) {
      attempts.push({ form: label, success: false, error: e.toString() });
      return false;
    }
  }

  if (attempt("seconds", startSeconds, endSeconds)) {
    return { ok: true, attempts: attempts };
  }

  var startTicks = String(Math.round(startSeconds * TICKS_PER_SECOND));
  var endTicks = String(Math.round(endSeconds * TICKS_PER_SECOND));
  if (attempt("ticksString", startTicks, endTicks)) {
    return { ok: true, attempts: attempts };
  }

  var startTime = new Time();
  startTime.seconds = startSeconds;
  var endTime = new Time();
  endTime.seconds = endSeconds;
  if (attempt("TimeObject", startTime, endTime)) {
    return { ok: true, attempts: attempts };
  }

  return { ok: false, attempts: attempts };
}

function getSequenceFps(sequence) {
  var frameDuration = sequence.getSettings().videoFrameRate;
  var ticksPerFrame = parseInt(frameDuration.ticks, 10);
  return Math.round(TICKS_PER_SECOND / ticksPerFrame);
}

function timecodeToSeconds(timecode, fps) {
  var parts = timecode.split(":");
  var minutes = parseInt(parts[0], 10);
  var seconds = parseInt(parts[1], 10);
  var frames = parseInt(parts[2], 10);
  return minutes * 60 + seconds + frames / fps;
}

// Shared clip serializer — used by get-active-sequence, get-full-sequence-
// info, get-full-clip-info, and get-timeline-summary (all standard-DOM
// reads, no QE needed). Every field is individually try/caught so one
// unreadable field never blanks out the rest of the clip. Seconds are read
// via a Time-like object's `.seconds` first (usually present), falling
// back to `.ticks` per PREMIERE_API_NOTES.md's ticks-are-strings rule.
function timeValueToSeconds(timeLike) {
  if (timeLike === null || typeof timeLike === "undefined") {
    return null;
  }
  if (typeof timeLike.seconds === "number") {
    return timeLike.seconds;
  }
  return Number(timeLike.ticks) / TICKS_PER_SECOND;
}

function serializeTrackItem(clip, trackIndex, clipIndex) {
  var out = {
    name: null,
    trackIndex: trackIndex,
    clipIndex: clipIndex,
    nodeId: null,
    startSeconds: null,
    endSeconds: null,
    inPointSeconds: null,
    outPointSeconds: null,
    durationSeconds: null,
    mediaPath: null,
    disabled: null
  };

  try { out.name = clip.name; } catch (e) { out.name = null; }
  try { out.nodeId = clip.nodeId; } catch (e) { out.nodeId = null; }
  try { out.startSeconds = timeValueToSeconds(clip.start); } catch (e) { out.startSeconds = null; }
  try { out.endSeconds = timeValueToSeconds(clip.end); } catch (e) { out.endSeconds = null; }
  try { out.inPointSeconds = timeValueToSeconds(clip.inPoint); } catch (e) { out.inPointSeconds = null; }
  try { out.outPointSeconds = timeValueToSeconds(clip.outPoint); } catch (e) { out.outPointSeconds = null; }
  try { out.durationSeconds = timeValueToSeconds(clip.duration); } catch (e) { out.durationSeconds = null; }
  try { out.mediaPath = clip.projectItem.getMediaPath(); } catch (e) { out.mediaPath = null; }
  try { out.disabled = clip.disabled; } catch (e) { out.disabled = null; }

  return out;
}

// ---------------------------------------------------------------------------
// Clip component/property helpers — shared by the wave-3 clip transform and
// opacity setter commands: set-clip-position, set-clip-scale,
// set-clip-rotation, set-clip-anchor-point, set-clip-opacity,
// set-uniform-scale, set-scale-width-height, set-anti-alias-quality, and
// set-blend-mode. Per PREMIERE_API_NOTES.md's "Effects, transitions,
// keyframes" section: components[0]=Motion/[1]=Opacity is only a
// convention, never a guarantee — identify a component by matchName
// ("AE.ADBE Motion"/"AE.ADBE Opacity") where possible, falling back to
// displayName. displayName matching is locale-dependent ("Nivel", "Pegel",
// "音量") — try an exact match first, then a normalized-lowercase match.
// ---------------------------------------------------------------------------

function normalizeDisplayName(name) {
  return String(name).toLowerCase();
}

// Finds a clip component (Motion/Opacity/an applied effect) by matchName
// first (exact, reliable, locale-independent), falling back to displayName
// (exact, then normalized-lowercase). matchNames/displayNames are arrays;
// either may be omitted/empty.
function findClipComponent(clip, matchNames, displayNames) {
  var numComponents;
  try {
    numComponents = clip.components.numItems;
  } catch (e) {
    return null;
  }

  if (matchNames && matchNames.length) {
    for (var i = 0; i < numComponents; i++) {
      var comp = clip.components[i];
      var mn = null;
      try { mn = comp.matchName; } catch (e) { mn = null; }
      if (mn) {
        for (var m = 0; m < matchNames.length; m++) {
          if (mn === matchNames[m]) {
            return comp;
          }
        }
      }
    }
  }

  if (displayNames && displayNames.length) {
    // Exact-match pass.
    for (var i2 = 0; i2 < numComponents; i2++) {
      var comp2 = clip.components[i2];
      var dn2 = null;
      try { dn2 = comp2.displayName; } catch (e) { dn2 = null; }
      if (dn2) {
        for (var d = 0; d < displayNames.length; d++) {
          if (dn2 === displayNames[d]) {
            return comp2;
          }
        }
      }
    }
    // Normalized-lowercase fallback pass (locale-dependent displayName).
    for (var i3 = 0; i3 < numComponents; i3++) {
      var comp3 = clip.components[i3];
      var dn3 = null;
      try { dn3 = comp3.displayName; } catch (e) { dn3 = null; }
      if (dn3) {
        var dn3Lower = normalizeDisplayName(dn3);
        for (var d2 = 0; d2 < displayNames.length; d2++) {
          if (dn3Lower === normalizeDisplayName(displayNames[d2])) {
            return comp3;
          }
        }
      }
    }
  }

  return null;
}

// Finds a property on a component by displayName — same exact-then-
// normalized-lowercase matching as findClipComponent.
function findComponentProperty(component, displayNames) {
  var numProps;
  try {
    numProps = component.properties.numItems;
  } catch (e) {
    return null;
  }

  for (var i = 0; i < numProps; i++) {
    var prop = component.properties[i];
    var dn = null;
    try { dn = prop.displayName; } catch (e) { dn = null; }
    if (dn) {
      for (var d = 0; d < displayNames.length; d++) {
        if (dn === displayNames[d]) {
          return prop;
        }
      }
    }
  }

  for (var i2 = 0; i2 < numProps; i2++) {
    var prop2 = component.properties[i2];
    var dn2 = null;
    try { dn2 = prop2.displayName; } catch (e) { dn2 = null; }
    if (dn2) {
      var dn2Lower = normalizeDisplayName(dn2);
      for (var d2 = 0; d2 < displayNames.length; d2++) {
        if (dn2Lower === normalizeDisplayName(displayNames[d2])) {
          return prop2;
        }
      }
    }
  }

  return null;
}

// Numeric/array-tolerant equality check for verifying a setValue() actually
// took — floats can round-trip imprecisely, and properties like
// Position/Anchor Point are two-element [x,y] arrays rather than scalars.
function valuesApproximatelyEqual(a, b, tolerance) {
  var tol = typeof tolerance === "number" ? tolerance : 0.01;

  if (a instanceof Array || b instanceof Array) {
    if (!(a instanceof Array) || !(b instanceof Array)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!valuesApproximatelyEqual(a[i], b[i], tol)) {
        return false;
      }
    }
    return true;
  }

  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= tol;
  }

  return a === b;
}

// Sets one property's value, reading it before AND after the mutation.
// CRITICAL: undo is confirmed non-functional on this Premiere build (see
// the `undo` command's notes in README.md) — the returned previousValue is
// the caller's ONLY path to restore a property if a mutation turns out to
// be unwanted; callers must surface it to the caller/user, never discard
// it. Returns {found: false} if no property in displayNames exists on the
// component; otherwise {found: true, previousValue, requestedValue,
// newValue, verified} where verified is a tolerance-aware comparison of
// newValue against the requested value (see valuesApproximatelyEqual).
function setComponentProperty(component, displayNames, value, tolerance) {
  var prop = findComponentProperty(component, displayNames);
  if (!prop) {
    return { found: false };
  }

  var previousValue = null;
  try { previousValue = prop.getValue(); } catch (e) { previousValue = null; }

  prop.setValue(value, true);

  var newValue = null;
  try { newValue = prop.getValue(); } catch (e) { newValue = null; }

  return {
    found: true,
    previousValue: previousValue,
    requestedValue: value,
    newValue: newValue,
    verified: valuesApproximatelyEqual(newValue, value, tolerance)
  };
}

// ---------------------------------------------------------------------------
// Shared helpers for wave-3 clip audio/flag mutation commands
// ---------------------------------------------------------------------------

// Makes the resolved sequence active first if it isn't already — required
// before any QE DOM call, which only ever operates on the active sequence
// tab (same pattern as get-qe-clip-info/remove-track-intervals).
function activateSequenceForQE(seq) {
  if (app.project.activeSequence !== seq) {
    app.project.activeSequence = seq;
  }
}

// Finds a clip's Volume component's Level property (audioVolume/Level) —
// shared by set-clip-volume, adjust-audio-levels, add-audio-keyframes.
// Returns the property object, or null if not found (e.g. not an audio
// clip, or this Premiere build's Volume component uses a different
// displayName — see PREMIERE_API_NOTES.md's locale-dependent-matching
// caveat, though we only probe the English name here).
function findVolumeLevelProperty(clip) {
  try {
    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      var compName = null;
      var compMatch = null;
      try { compName = comp.displayName; } catch (e) { compName = null; }
      try { compMatch = comp.matchName; } catch (e) { compMatch = null; }
      if (compName === "Volume" || compMatch === "audioVolume") {
        for (var p = 0; p < comp.properties.numItems; p++) {
          var propName = null;
          try { propName = comp.properties[p].displayName; } catch (e) { propName = null; }
          if (propName === "Level") {
            return comp.properties[p];
          }
        }
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Finds a clip's Panner component's Balance/Pan property — shared by
// set-clip-pan. Component is usually "Panner" with a "Balance" property
// (mono-to-stereo pan); some builds/locales may expose "Pan" instead — both
// are probed, same defensive approach as the reference tool.
function findPannerProperty(clip) {
  try {
    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      var compName = null;
      try { compName = comp.displayName; } catch (e) { compName = null; }
      if (compName === "Panner") {
        for (var p = 0; p < comp.properties.numItems; p++) {
          var propName = null;
          try { propName = comp.properties[p].displayName; } catch (e) { propName = null; }
          if (propName === "Balance" || propName === "Pan") {
            return comp.properties[p];
          }
        }
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

// dB <-> linear-amplitude conversion for the audio Level property, per
// hetpatel's empirically-calibrated formula for this build family
// (PREMIERE_API_NOTES.md: "displayed 0 dB ~= internal 0.17783",
// linear = 10^((dB-15)/20)). leancoderkavy's own repo uses the simpler,
// UNCALIBRATED 10^(dB/20) instead, and ayushozha mostly passes raw dB
// straight through — the three reference repos do NOT agree, and none of
// this has been verified against our own Premiere build (no live audio
// clip available at authoring time). Treat every dB value that passes
// through these two functions as approximate until calibrated live.
function dbToLinearCalibrated(db) {
  return Math.pow(10, (db - 15) / 20);
}
function linearToDbCalibrated(linear) {
  if (!(linear > 0)) {
    return null;
  }
  return 20 * Math.log(linear) / Math.LN10 + 15;
}

// QE track item lists interleave "Empty" gap items between real clips
// (PREMIERE_API_NOTES.md / QE_DOM_NOTES.md) — the standard DOM's Nth clip
// on a track is the Nth item whose QE .type is NOT "Empty" (matches our own
// confirmed finding, not just the reference repos' claim). Shared by
// set-frame-blend and set-time-interpolation, which both need to locate the
// QE clip corresponding to a standard-DOM clipIndex.
function qeFindNthNonEmptyClip(qeTrack, clipIndex) {
  var seen = -1;
  var numItems = qeTrack.numItems;
  for (var i = 0; i < numItems; i++) {
    var item = qeTrack.getItemAt(i);
    var itemType = null;
    try { itemType = item.type; } catch (e) { itemType = null; }
    if (itemType === "Empty") {
      continue;
    }
    seen++;
    if (seen === clipIndex) {
      return item;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wave-4 effect/component helpers — shared by the effect apply/remove/copy
// commands (apply-effect, apply-audio-effect, remove-effect,
// remove-effect-by-name, remove-all-effects, color-correct, apply-lut,
// stabilize-clip, copy-effects-between-clips, copy-effect-values,
// batch-apply-effect). Builds on findClipComponent/findComponentProperty/
// setComponentProperty/valuesApproximatelyEqual/qeFindNthNonEmptyClip above.
// ---------------------------------------------------------------------------

// Resolves a standard-DOM timeline clip from trackType/trackIndex/clipIndex,
// with the same out-of-range error messages set-frame-blend uses. Returns
// {clip: <TrackItem>} on success or {error: "..."} on failure — never
// throws.
function resolveTimelineClip(seq, trackType, trackIndex, clipIndex) {
  var trackCollection = trackType === "video" ? seq.videoTracks : seq.audioTracks;
  var numTracks = trackCollection.numTracks;
  if (trackIndex >= numTracks) {
    return { error: "trackIndex " + trackIndex + " is out of range — sequence has " + numTracks + " " + trackType + " track(s)" };
  }
  var track = trackCollection[trackIndex];
  var numClips = track.clips.numItems;
  if (clipIndex >= numClips) {
    return { error: "clipIndex " + clipIndex + " is out of range — track " + trackIndex + " has " + numClips + " clip(s)" };
  }
  return { clip: track.clips[clipIndex] };
}

// Resolves the QE-DOM clip corresponding to a standard-DOM
// trackType/trackIndex/clipIndex, on an already-activated qeSeq (see
// activateSequenceForQE). Returns {qeClip, qeTrack} on success or
// {error: "..."} on failure — same pattern as set-frame-blend's inline
// lookup, factored out for reuse across the wave-4 effect commands.
function resolveQeClip(qeSeq, trackType, trackIndex, clipIndex) {
  var qeTrack;
  try {
    qeTrack = trackType === "video" ? qeSeq.getVideoTrackAt(trackIndex) : qeSeq.getAudioTrackAt(trackIndex);
  } catch (e) {
    return { error: "QE track lookup failed: " + e.toString() };
  }
  if (!qeTrack) {
    return { error: "QE track not found at index " + trackIndex };
  }
  var qeClip;
  try {
    qeClip = qeFindNthNonEmptyClip(qeTrack, clipIndex);
  } catch (e) {
    return { error: "QE clip lookup failed: " + e.toString() };
  }
  if (!qeClip) {
    return { error: "could not locate the corresponding non-Empty QE clip at clipIndex " + clipIndex };
  }
  return { qeClip: qeClip, qeTrack: qeTrack };
}

// Serializes a clip's components collection to a plain array of
// {displayName, matchName} — the "before"/"after" snapshot every mutating
// effect command reports per the wave-4 verification rule (read
// clip.components before/after, report counts AND names).
function serializeClipComponents(clip) {
  var out = [];
  try {
    var numComponents = clip.components.numItems;
    for (var i = 0; i < numComponents; i++) {
      var comp = clip.components[i];
      var dn = null;
      var mn = null;
      try { dn = comp.displayName; } catch (e) { dn = null; }
      try { mn = comp.matchName; } catch (e) { mn = null; }
      out.push({ displayName: dn, matchName: mn });
    }
  } catch (e) {
    // fall through — caller sees an empty array, not a thrown error
  }
  return out;
}

// Looks up a video effect by name in the QE catalog — getVideoEffectByName
// first (per PREMIERE_API_NOTES.md's documented "universal dance"), falling
// back to a linear scan of getVideoEffectList() in case the by-name lookup
// itself is unavailable/unreliable on this build. Returns the QE effect
// object, or null if not found by either path.
function findQeVideoEffectByName(name) {
  try {
    var fx = qe.project.getVideoEffectByName(name);
    if (fx) {
      return fx;
    }
  } catch (e) {
    // fall through to list scan
  }
  try {
    var list = qe.project.getVideoEffectList();
    for (var i = 0; i < list.numItems; i++) {
      if (list[i].name === name) {
        return list[i];
      }
    }
  } catch (e) {
    // fall through — caller reports "not found"
  }
  return null;
}

// Audio counterpart of findQeVideoEffectByName.
function findQeAudioEffectByName(name) {
  try {
    var fx = qe.project.getAudioEffectByName(name);
    if (fx) {
      return fx;
    }
  } catch (e) {
    // fall through to list scan
  }
  try {
    var list = qe.project.getAudioEffectList();
    for (var i = 0; i < list.numItems; i++) {
      if (list[i].name === name) {
        return list[i];
      }
    }
  } catch (e) {
    // fall through — caller reports "not found"
  }
  return null;
}

// Built-in components no removal command should ever touch — checked by
// BOTH matchName (reliable, locale-independent) and displayName (fallback,
// locale-dependent) per remove-effect's "protect the built-ins" rule.
function isProtectedBuiltinComponent(comp) {
  var mn = null;
  var dn = null;
  try { mn = comp.matchName; } catch (e) { mn = null; }
  try { dn = comp.displayName; } catch (e) { dn = null; }

  var protectedMatchNames = ["AE.ADBE Motion", "AE.ADBE Opacity"];
  for (var i = 0; i < protectedMatchNames.length; i++) {
    if (mn === protectedMatchNames[i]) {
      return true;
    }
  }
  var protectedDisplayNames = ["Motion", "Opacity"];
  for (var j = 0; j < protectedDisplayNames.length; j++) {
    if (dn === protectedDisplayNames[j]) {
      return true;
    }
  }
  return false;
}

// Intrinsic/non-effect component display names — copy-effects-between-clips
// skips these when no effectName filter narrows the copy to one effect
// (matches leancoderkavy's clipboard.ts intrinsic list).
var INTRINSIC_COMPONENT_DISPLAY_NAMES = ["Motion", "Opacity", "Time Remapping", "Volume", "Channel Volume", "Panner"];

function isIntrinsicComponentDisplayName(name) {
  for (var i = 0; i < INTRINSIC_COMPONENT_DISPLAY_NAMES.length; i++) {
    if (name === INTRINSIC_COMPONENT_DISPLAY_NAMES[i]) {
      return true;
    }
  }
  return false;
}

// Finds (and applies via QE if missing) the Lumetri Color component on a
// clip — shared by color-correct and apply-lut, both of which need it
// present before setting properties. seq must already be the clip's own
// sequence; QE will be activated on it if the effect needs applying.
// Returns {component, applied} on success (applied = true if this call had
// to add it) or {error: "..."} on failure.
function ensureLumetriColorComponent(seq, trackType, trackIndex, clipIndex, clip) {
  var existing = findClipComponent(clip, ["AE.ADBE Lumetri"], ["Lumetri Color"]);
  if (existing) {
    return { component: existing, applied: false };
  }

  try {
    ensureQEEnabled();
    activateSequenceForQE(seq);
  } catch (e) {
    return { error: "app.enableQE()/sequence activation failed: " + e.toString() };
  }
  if (typeof qe === "undefined" || !qe.project) {
    return { error: "QE DOM not available after enableQE()" };
  }

  var qeSeq;
  try {
    qeSeq = qe.project.getActiveSequence();
  } catch (e) {
    return { error: "qe.project.getActiveSequence() failed: " + e.toString() };
  }

  var qeResolved = resolveQeClip(qeSeq, trackType, trackIndex, clipIndex);
  if (qeResolved.error) {
    return { error: qeResolved.error };
  }

  var fx = findQeVideoEffectByName("Lumetri Color");
  if (!fx) {
    return { error: "Lumetri Color effect not found in this Premiere install's QE effect catalog" };
  }

  try {
    qeResolved.qeClip.addVideoEffect(fx);
  } catch (e) {
    return { error: "qeClip.addVideoEffect(Lumetri Color) failed: " + e.toString() };
  }

  var reFound = findClipComponent(clip, ["AE.ADBE Lumetri"], ["Lumetri Color"]);
  if (!reFound) {
    return { error: "Lumetri Color was applied via QE but could not be re-found on the standard-DOM clip afterward" };
  }
  return { component: reFound, applied: true };
}

// ---------------------------------------------------------------------------
// Keyframe/effect-property helpers — shared by wave-4's get-effect-properties,
// set-effect-property, get-keyframes, add-keyframe, remove-keyframe,
// remove-keyframe-range, set-keyframe-interpolation, get-value-at-time, and
// set-color-value. Per PREMIERE_API_NOTES.md's Property API section: a
// property's key TIME argument is Time objects on some Premiere builds and
// plain seconds on others (version drift) — tryTimeForms() below tries
// ticksString, then a Time object, then a raw seconds number, recording an
// `attempts` array so callers can see exactly what worked, same spirit as
// index.jsx's own trySetSequenceRange(). Component lookup for these commands
// is deliberately GENERIC (any component, not just Motion/Opacity) — callers
// pass an arbitrary componentName as BOTH the matchName and displayName
// candidate list to the existing findClipComponent() helper above.
// ---------------------------------------------------------------------------

function secondsToTicksString(seconds) {
  return String(Math.round(seconds * TICKS_PER_SECOND));
}

function secondsToTimeObject(seconds) {
  var t = new Time();
  t.seconds = seconds;
  return t;
}

// Calls fn(timeArg) trying, in order: a ticks string, a Time object, then a
// raw seconds number — stopping at the first form fn() doesn't throw on.
// fn's return value (if any) is carried through as `result`. Returns
// {success, result?, attempts, formUsed?} — attempts is always populated,
// even on total failure, so the caller can report exactly what was tried.
function tryTimeForms(seconds, fn) {
  var attempts = [];
  var forms = [
    { label: "ticksString", value: secondsToTicksString(seconds) },
    { label: "TimeObject", value: secondsToTimeObject(seconds) },
    { label: "seconds", value: seconds }
  ];
  for (var i = 0; i < forms.length; i++) {
    try {
      var result = fn(forms[i].value);
      attempts.push({ form: forms[i].label, success: true });
      return { success: true, result: result, attempts: attempts, formUsed: forms[i].label };
    } catch (e) {
      attempts.push({ form: forms[i].label, success: false, error: e.toString() });
    }
  }
  return { success: false, attempts: attempts };
}

// Normalizes a key time value returned by prop.getKeys()/etc. to seconds.
// Per PREMIERE_API_NOTES.md, key times are DISPUTED across builds: Time
// objects (handled by the existing timeValueToSeconds()), or — per some
// repos/builds — a raw ticks number/string, or a raw seconds number/string.
// A raw numeric/string value is heuristically treated as ticks if it's
// larger than 1,000,000 (no realistic sequence position is that many
// seconds — over 11 days — while ticks routinely exceed it), else as plain
// seconds. This heuristic is UNVERIFIED against a live keyframed property.
function keyTimeToSeconds(keyTime) {
  if (keyTime === null || typeof keyTime === "undefined") {
    return null;
  }
  if (typeof keyTime === "number") {
    return keyTime > 1000000 ? (keyTime / TICKS_PER_SECOND) : keyTime;
  }
  if (typeof keyTime === "string") {
    var n = Number(keyTime);
    if (isNaN(n)) {
      return null;
    }
    return n > 1000000 ? (n / TICKS_PER_SECOND) : n;
  }
  return timeValueToSeconds(keyTime);
}

// ---------------------------------------------------------------------------
// Shared helper for wave-4 transition mutation commands (add-transition,
// batch-add-transitions) — see PREMIERE_API_NOTES.md's "Transitions (QE
// only)" line: qe.project.getVideoTransitionByName(name) resolves the
// transition, then addTransition() is called with a DISPUTED argument
// count/duration format across the three reference repos (3-7 args;
// "frames:00" timecode string vs seconds-string vs ticks string), on
// EITHER the QE clip or the QE track depending on which repo you read.
// Rather than pick one, every plausible form is tried in turn and success
// is verified the only reliable way available: a numItems delta on the
// STANDARD DOM's track.transitions collection (QE addTransition's own
// return value is not trustworthy — same lesson as export-frame's
// exportFramePNG). Video-only: no reference repo demonstrates an
// audio-transition "add" API, only add-transition's video enumeration
// (list-available-transitions) and audio's own list-only command.
// ---------------------------------------------------------------------------

function ppbGetTrackTransitionsCount(track) {
  try {
    return track.transitions.numItems;
  } catch (e) {
    return null;
  }
}

function ppbReadLastTransitionName(track) {
  try {
    var n = track.transitions.numItems;
    if (n <= 0) {
      return null;
    }
    var t = track.transitions[n - 1];
    try { return t.name; } catch (e) { return null; }
  } catch (e2) {
    return null;
  }
}

// Applies one transition to one clip's start/end, addressed the same way
// as get-full-clip-info (trackIndex/clipIndex on seq.videoTracks — video
// only). `transitionQE` is the already-resolved QE transition object (or
// null for "default transition", per ayushozha's addTransition(null, true,
// "1.0") convention). Returns a plain object — never throws; every
// failure mode is captured in the returned shape so callers (add-
// transition, batch-add-transitions) can report per-clip results
// uniformly.
function ppbApplyTransitionToClip(seq, trackIndex, clipIndex, transitionQE, atEnd, durationSeconds) {
  var out = {
    trackIndex: trackIndex,
    clipIndex: clipIndex,
    clipName: null,
    previousCount: null,
    newCount: null,
    verified: false,
    attempts: [],
    succeededWithArgs: null,
    addedTransitionName: null,
    error: null
  };

  var numTracks;
  try { numTracks = seq.videoTracks.numTracks; } catch (e) { numTracks = 0; }
  if (trackIndex >= numTracks) {
    out.error = "trackIndex " + trackIndex + " is out of range — sequence has " + numTracks + " video track(s)";
    return out;
  }
  var track = seq.videoTracks[trackIndex];
  var numClips;
  try { numClips = track.clips.numItems; } catch (e2) { numClips = 0; }
  if (clipIndex >= numClips) {
    out.error = "clipIndex " + clipIndex + " is out of range — track " + trackIndex + " has " + numClips + " clip(s)";
    return out;
  }

  var clip = track.clips[clipIndex];
  try { out.clipName = clip.name; } catch (e3) { out.clipName = null; }

  out.previousCount = ppbGetTrackTransitionsCount(track);

  try {
    ensureQEEnabled();
    activateSequenceForQE(seq);
  } catch (e4) {
    out.error = "app.enableQE()/sequence activation failed: " + e4.toString();
    return out;
  }
  if (typeof qe === "undefined" || !qe.project) {
    out.error = "QE DOM not available after enableQE()";
    return out;
  }

  var qeSeq, qeTrack, qeClip;
  try {
    qeSeq = qe.project.getActiveSequence();
    qeTrack = qeSeq.getVideoTrackAt(trackIndex);
    qeClip = qeFindNthNonEmptyClip(qeTrack, clipIndex);
  } catch (e5) {
    out.error = "QE track/clip lookup failed: " + e5.toString();
    return out;
  }
  if (!qeTrack || !qeClip) {
    out.error = "could not locate the corresponding QE track/clip";
    return out;
  }

  var secondsStr = String(durationSeconds);
  var ticksStr = String(Math.round(durationSeconds * TICKS_PER_SECOND));
  var cutTicksStr = null;
  try { cutTicksStr = (atEnd ? clip.end.ticks : clip.start.ticks).toString(); } catch (e6) { cutTicksStr = null; }

  function attempt(label, fn) {
    if (out.verified) {
      return;
    }
    var entry = { form: label };
    try {
      fn();
      entry.success = true;
    } catch (e7) {
      entry.success = false;
      entry.error = e7.toString();
      out.attempts.push(entry);
      return;
    }
    var newCount = ppbGetTrackTransitionsCount(track);
    if (newCount !== null && out.previousCount !== null && newCount > out.previousCount) {
      entry.verifiedCount = newCount;
      out.verified = true;
      out.newCount = newCount;
      out.succeededWithArgs = label;
      out.addedTransitionName = ppbReadLastTransitionName(track);
    } else {
      entry.note = "call did not throw, but transitions count did not increase — treating as unverified";
    }
    out.attempts.push(entry);
  }

  // qeClip-level forms (per PREMIERE_API_NOTES.md's headline signature).
  attempt("qeClip.addTransition(tr, atEnd, secondsString)", function () {
    qeClip.addTransition(transitionQE, atEnd, secondsStr);
  });
  attempt("qeClip.addTransition(tr, atEnd, ticksString)", function () {
    qeClip.addTransition(transitionQE, atEnd, ticksStr);
  });
  attempt("qeClip.addTransition(tr, atEnd, secondsString, \"0\")", function () {
    qeClip.addTransition(transitionQE, atEnd, secondsStr, "0");
  });
  attempt("qeClip.addTransition(tr, atEnd, ticksString, \"0\", false)", function () {
    qeClip.addTransition(transitionQE, atEnd, ticksStr, "0", false);
  });
  attempt("qeClip.addTransition(tr, atEnd, durationSecondsNumber)", function () {
    qeClip.addTransition(transitionQE, atEnd, durationSeconds);
  });
  // qeTrack-level forms (leancoderkavy's own reference implementation —
  // cut-point ticks + duration ticks + alignment + reverse booleans).
  if (cutTicksStr !== null) {
    attempt("qeTrack.addTransition(tr, atEnd, cutTicks, durationTicks, \"0\", false)", function () {
      qeTrack.addTransition(transitionQE, atEnd, cutTicksStr, ticksStr, "0", false);
    });
    attempt("qeTrack.addTransition(tr, atEnd, cutTicks, durationSeconds, \"0\", false)", function () {
      qeTrack.addTransition(transitionQE, atEnd, cutTicksStr, secondsStr, "0", false);
    });
  }

  if (!out.verified) {
    out.error = "could not add the transition with any known argument form — see attempts";
  }

  return out;
}

// ---------------------------------------------------------------------------
// Lazy command dispatch
// ---------------------------------------------------------------------------

// Command name → { file under host/commands/, ppb_ function it defines }.
// To add a command: create host/commands/<name>.jsx defining the function,
// add a line here, and add the command name to main.js's ALLOWED_COMMANDS.
var PPB_COMMANDS = {
  "create-sequence": { file: "create-sequence.jsx", fn: "ppb_createSequence" },
  "extract-audio-track": { file: "extract-audio-track.jsx", fn: "ppb_extractAudioTrack" },
  "remove-track-intervals": { file: "remove-track-intervals.jsx", fn: "ppb_removeTrackIntervals" },
  "export-frame": { file: "export-frame.jsx", fn: "ppb_exportFrame" },
  "get-project-info": { file: "get-project-info.jsx", fn: "ppb_getProjectInfo" },
  "list-project-items": { file: "list-project-items.jsx", fn: "ppb_listProjectItems" },
  "get-full-project-overview": { file: "get-full-project-overview.jsx", fn: "ppb_getFullProjectOverview" },
  "search-project-items": { file: "search-project-items.jsx", fn: "ppb_searchProjectItems" },
  "get-active-sequence": { file: "get-active-sequence.jsx", fn: "ppb_getActiveSequence" },
  "get-full-sequence-info": { file: "get-full-sequence-info.jsx", fn: "ppb_getFullSequenceInfo" },
  "get-full-clip-info": { file: "get-full-clip-info.jsx", fn: "ppb_getFullClipInfo" },
  "get-timeline-summary": { file: "get-timeline-summary.jsx", fn: "ppb_getTimelineSummary" },
  "set-clip-volume": { file: "set-clip-volume.jsx", fn: "ppb_setClipVolume" },
  "set-clip-pan": { file: "set-clip-pan.jsx", fn: "ppb_setClipPan" },
  "adjust-audio-levels": { file: "adjust-audio-levels.jsx", fn: "ppb_adjustAudioLevels" },
  "add-audio-keyframes": { file: "add-audio-keyframes.jsx", fn: "ppb_addAudioKeyframes" },
  "rename-clip": { file: "rename-clip.jsx", fn: "ppb_renameClip" },
  "batch-rename-clips": { file: "batch-rename-clips.jsx", fn: "ppb_batchRenameClips" },
  "set-clip-enabled": { file: "set-clip-enabled.jsx", fn: "ppb_setClipEnabled" },
  "batch-set-clips-enabled": { file: "batch-set-clips-enabled.jsx", fn: "ppb_batchSetClipsEnabled" },
  "set-frame-blend": { file: "set-frame-blend.jsx", fn: "ppb_setFrameBlend" },
  "set-time-interpolation": { file: "set-time-interpolation.jsx", fn: "ppb_setTimeInterpolation" },
  "set-clip-properties": { file: "set-clip-properties.jsx", fn: "ppb_setClipProperties" },
  "set-item-metadata": { file: "set-item-metadata.jsx", fn: "ppb_setItemMetadata" },
  "set-color-label": { file: "set-color-label.jsx", fn: "ppb_setColorLabel" },
  "set-footage-interpretation": { file: "set-footage-interpretation.jsx", fn: "ppb_setFootageInterpretation" },
  "set-xmp-metadata": { file: "set-xmp-metadata.jsx", fn: "ppb_setXmpMetadata" },
  "get-effect-properties": { file: "get-effect-properties.jsx", fn: "ppb_getEffectProperties" },
  "set-effect-property": { file: "set-effect-property.jsx", fn: "ppb_setEffectProperty" },
  "get-keyframes": { file: "get-keyframes.jsx", fn: "ppb_getKeyframes" },
  "add-keyframe": { file: "add-keyframe.jsx", fn: "ppb_addKeyframe" },
  "remove-keyframe": { file: "remove-keyframe.jsx", fn: "ppb_removeKeyframe" },
  "remove-keyframe-range": { file: "remove-keyframe-range.jsx", fn: "ppb_removeKeyframeRange" },
  "set-keyframe-interpolation": { file: "set-keyframe-interpolation.jsx", fn: "ppb_setKeyframeInterpolation" },
  "get-value-at-time": { file: "get-value-at-time.jsx", fn: "ppb_getValueAtTime" },
  "set-color-value": { file: "set-color-value.jsx", fn: "ppb_setColorValue" },
  "add-transition": { file: "add-transition.jsx", fn: "ppb_addTransition" },
  "batch-add-transitions": { file: "batch-add-transitions.jsx", fn: "ppb_batchAddTransitions" },
  "remove-transition": { file: "remove-transition.jsx", fn: "ppb_removeTransition" },
  "ripple-delete-clip": { file: "ripple-delete-clip.jsx", fn: "ppb_rippleDeleteClip" },
  "roll-edit": { file: "roll-edit.jsx", fn: "ppb_rollEdit" },
  "slide-edit": { file: "slide-edit.jsx", fn: "ppb_slideEdit" },
  "slip-edit": { file: "slip-edit.jsx", fn: "ppb_slipEdit" },
  "move-clip-to-track": { file: "move-clip-to-track.jsx", fn: "ppb_moveClipToTrack" },
  "reverse-clip": { file: "reverse-clip.jsx", fn: "ppb_reverseClip" },
  "link-selection": { file: "link-selection.jsx", fn: "ppb_linkSelection" },
  "unlink-selection": { file: "unlink-selection.jsx", fn: "ppb_unlinkSelection" },
  "overwrite-clip-at": { file: "overwrite-clip-at.jsx", fn: "ppb_overwriteClipAt" },
  "razor-all-tracks": { file: "razor-all-tracks.jsx", fn: "ppb_razorAllTracks" },
  "set-item-in-out": { file: "set-item-in-out.jsx", fn: "ppb_setItemInOut" },
  "clear-item-in-out": { file: "clear-item-in-out.jsx", fn: "ppb_clearItemInOut" },
  "clear-sequence-in-out": { file: "clear-sequence-in-out.jsx", fn: "ppb_clearSequenceInOut" },
  "remove-selected-clips": { file: "remove-selected-clips.jsx", fn: "ppb_removeSelectedClips" },
  "lift-selection": { file: "lift-selection.jsx", fn: "ppb_liftSelection" },
  "extract-selection": { file: "extract-selection.jsx", fn: "ppb_extractSelection" },
  "nest-clips": { file: "nest-clips.jsx", fn: "ppb_nestClips" },
  "freeze-frame": { file: "freeze-frame.jsx", fn: "ppb_freezeFrame" },
  "match-frame": { file: "match-frame.jsx", fn: "ppb_matchFrame" },
  "add-adjustment-layer": { file: "add-adjustment-layer.jsx", fn: "ppb_addAdjustmentLayer" },
  "unnest-sequence": { file: "unnest-sequence.jsx", fn: "ppb_unnestSequence" },
  "save-project": { file: "save-project.jsx", fn: "ppb_saveProject" },
  "save-project-as": { file: "save-project-as.jsx", fn: "ppb_saveProjectAs" },
  "open-project": { file: "open-project.jsx", fn: "ppb_openProject" },
  "set-active-sequence": { file: "set-active-sequence.jsx", fn: "ppb_setActiveSequence" },
  "find-items-by-media-path": { file: "find-items-by-media-path.jsx", fn: "ppb_findItemsByMediaPath" },
  "create-smart-bin": { file: "create-smart-bin.jsx", fn: "ppb_createSmartBin" },
  "add-custom-metadata-field": { file: "add-custom-metadata-field.jsx", fn: "ppb_addCustomMetadataField" },
  "import-sequences-from-project": { file: "import-sequences-from-project.jsx", fn: "ppb_importSequencesFromProject" },
  "import-fcp-xml": { file: "import-fcp-xml.jsx", fn: "ppb_importFcpXml" },
  "import-ae-comps": { file: "import-ae-comps.jsx", fn: "ppb_importAeComps" },
  "create-bars-and-tone": { file: "create-bars-and-tone.jsx", fn: "ppb_createBarsAndTone" },
  "set-transcode-on-ingest": { file: "set-transcode-on-ingest.jsx", fn: "ppb_setTranscodeOnIngest" },
  "set-project-panel-metadata": { file: "set-project-panel-metadata.jsx", fn: "ppb_setProjectPanelMetadata" },
  "get-graphics-white-luminance": { file: "get-graphics-white-luminance.jsx", fn: "ppb_getGraphicsWhiteLuminance" },
  "set-graphics-white-luminance": { file: "set-graphics-white-luminance.jsx", fn: "ppb_setGraphicsWhiteLuminance" },
  "duplicate-sequence": { file: "duplicate-sequence.jsx", fn: "ppb_duplicateSequence" },
  "set-sequence-settings": { file: "set-sequence-settings.jsx", fn: "ppb_setSequenceSettings" },
  "create-subsequence": { file: "create-subsequence.jsx", fn: "ppb_createSubsequence" },
  "auto-reframe-sequence": { file: "auto-reframe-sequence.jsx", fn: "ppb_autoReframeSequence" },
  "create-sequence-from-preset": { file: "create-sequence-from-preset.jsx", fn: "ppb_createSequenceFromPreset" },
  "create-sequence-from-clips": { file: "create-sequence-from-clips.jsx", fn: "ppb_createSequenceFromClips" },
  "attach-custom-property": { file: "attach-custom-property.jsx", fn: "ppb_attachCustomProperty" },
  "close-sequence": { file: "close-sequence.jsx", fn: "ppb_closeSequence" },
  "export-sequence-as-project": { file: "export-sequence-as-project.jsx", fn: "ppb_exportSequenceAsProject" },
  "scene-edit-detection": { file: "scene-edit-detection.jsx", fn: "ppb_sceneEditDetection" },
  "export-sequence": { file: "export-sequence.jsx", fn: "ppb_exportSequence" },
  "export-fcp-xml": { file: "export-fcp-xml.jsx", fn: "ppb_exportFcpXml" },
  "export-aaf": { file: "export-aaf.jsx", fn: "ppb_exportAaf" },
  "export-omf": { file: "export-omf.jsx", fn: "ppb_exportOmf" },
  "add-to-render-queue": { file: "add-to-render-queue.jsx", fn: "ppb_addToRenderQueue" },
  "create-subclip": { file: "create-subclip.jsx", fn: "ppb_createSubclip" },
  "encode-project-item": { file: "encode-project-item.jsx", fn: "ppb_encodeProjectItem" },
  "encode-file": { file: "encode-file.jsx", fn: "ppb_encodeFile" },
  "manage-proxies": { file: "manage-proxies.jsx", fn: "ppb_manageProxies" },
  "open-in-source": { file: "open-in-source.jsx", fn: "ppb_openInSource" },
  "close-source-monitor": { file: "close-source-monitor.jsx", fn: "ppb_closeSourceMonitor" },
  "close-all-source-clips": { file: "close-all-source-clips.jsx", fn: "ppb_closeAllSourceClips" },
  "set-source-in-out": { file: "set-source-in-out.jsx", fn: "ppb_setSourceInOut" },
  "insert-from-source": { file: "insert-from-source.jsx", fn: "ppb_insertFromSource" },
  "overwrite-from-source": { file: "overwrite-from-source.jsx", fn: "ppb_overwriteFromSource" },
  "add-text-overlay": { file: "add-text-overlay.jsx", fn: "ppb_addTextOverlay" },
  "import-mogrt": { file: "import-mogrt.jsx", fn: "ppb_importMogrt" },
  "import-mogrt-from-library": { file: "import-mogrt-from-library.jsx", fn: "ppb_importMogrtFromLibrary" },
  "get-mogrt-component": { file: "get-mogrt-component.jsx", fn: "ppb_getMogrtComponent" },
  "create-caption-track": { file: "create-caption-track.jsx", fn: "ppb_createCaptionTrack" },
  "replace-clip-media": { file: "replace-clip-media.jsx", fn: "ppb_replaceClipMedia" },
  "debug-qe-inspect": { file: "debug-qe-inspect.jsx", fn: "ppb_debugQeInspect" },
  "debug-qe-try-mutate": { file: "debug-qe-try-mutate.jsx", fn: "ppb_debugQeTryMutate" },
  "get-premiere-state": { file: "get-premiere-state.jsx", fn: "ppb_getPremiereState" },
  "inspect-dom-object": { file: "inspect-dom-object.jsx", fn: "ppb_inspectDomObject" },
  "get-open-projects": { file: "get-open-projects.jsx", fn: "ppb_getOpenProjects" },
  "set-active-project": { file: "set-active-project.jsx", fn: "ppb_setActiveProject" },
  "move-playhead": { file: "move-playhead.jsx", fn: "ppb_movePlayhead" },
  "get-work-area": { file: "get-work-area.jsx", fn: "ppb_getWorkArea" },
  "set-work-area": { file: "set-work-area.jsx", fn: "ppb_setWorkArea" },
  "get-sequence-in-out": { file: "get-sequence-in-out.jsx", fn: "ppb_getSequenceInOut" },
  "set-sequence-in-out": { file: "set-sequence-in-out.jsx", fn: "ppb_setSequenceInOut" },
  "is-work-area-enabled": { file: "is-work-area-enabled.jsx", fn: "ppb_isWorkAreaEnabled" },
  "get-export-file-extension": { file: "get-export-file-extension.jsx", fn: "ppb_getExportFileExtension" },
  "get-workspaces": { file: "get-workspaces.jsx", fn: "ppb_getWorkspaces" },
  "set-workspace": { file: "set-workspace.jsx", fn: "ppb_setWorkspace" },
  "play-timeline": { file: "play-timeline.jsx", fn: "ppb_playTimeline" },
  "stop-playback": { file: "stop-playback.jsx", fn: "ppb_stopPlayback" },
  "play-source-monitor": { file: "play-source-monitor.jsx", fn: "ppb_playSourceMonitor" },
  "get-source-monitor-position": { file: "get-source-monitor-position.jsx", fn: "ppb_getSourceMonitorPosition" },
  "get-version-info": { file: "get-version-info.jsx", fn: "ppb_getVersionInfo" },
  "get-bin-contents": { file: "get-bin-contents.jsx", fn: "ppb_getBinContents" },
  "get-project-item-info": { file: "get-project-item-info.jsx", fn: "ppb_getProjectItemInfo" },
  "get-timeline-gaps": { file: "get-timeline-gaps.jsx", fn: "ppb_getTimelineGaps" },
  "get-offline-media": { file: "get-offline-media.jsx", fn: "ppb_getOfflineMedia" },
  "get-used-media-report": { file: "get-used-media-report.jsx", fn: "ppb_getUsedMediaReport" },
  "get-all-project-paths": { file: "get-all-project-paths.jsx", fn: "ppb_getAllProjectPaths" },
  "get-unused-media": { file: "get-unused-media.jsx", fn: "ppb_getUnusedMedia" },
  "get-duplicate-media": { file: "get-duplicate-media.jsx", fn: "ppb_getDuplicateMedia" },
  "get-clip-links": { file: "get-clip-links.jsx", fn: "ppb_getClipLinks" },
  "get-insertion-bin": { file: "get-insertion-bin.jsx", fn: "ppb_getInsertionBin" },
  "get-project-panel-metadata": { file: "get-project-panel-metadata.jsx", fn: "ppb_getProjectPanelMetadata" },
  "list-available-effects": { file: "list-available-effects.jsx", fn: "ppb_listAvailableEffects" },
  "list-available-audio-effects": { file: "list-available-audio-effects.jsx", fn: "ppb_listAvailableAudioEffects" },
  "list-available-transitions": { file: "list-available-transitions.jsx", fn: "ppb_listAvailableTransitions" },
  "list-available-audio-transitions": { file: "list-available-audio-transitions.jsx", fn: "ppb_listAvailableAudioTransitions" },
  "list-markers": { file: "list-markers.jsx", fn: "ppb_listMarkers" },
  "get-clip-markers": { file: "get-clip-markers.jsx", fn: "ppb_getClipMarkers" },
  "get-sequence-markers-by-type": { file: "get-sequence-markers-by-type.jsx", fn: "ppb_getSequenceMarkersByType" },
  "get-item-metadata": { file: "get-item-metadata.jsx", fn: "ppb_getItemMetadata" },
  "get-color-label": { file: "get-color-label.jsx", fn: "ppb_getColorLabel" },
  "get-footage-interpretation": { file: "get-footage-interpretation.jsx", fn: "ppb_getFootageInterpretation" },
  "get-xmp-metadata": { file: "get-xmp-metadata.jsx", fn: "ppb_getXmpMetadata" },
  "get-color-space": { file: "get-color-space.jsx", fn: "ppb_getColorSpace" },
  "get-render-queue-status": { file: "get-render-queue-status.jsx", fn: "ppb_getRenderQueueStatus" },
  "get-clip-at-position": { file: "get-clip-at-position.jsx", fn: "ppb_getClipAtPosition" },
  "get-clip-at-playhead": { file: "get-clip-at-playhead.jsx", fn: "ppb_getClipAtPlayhead" },
  "get-next-edit-point": { file: "get-next-edit-point.jsx", fn: "ppb_getNextEditPoint" },
  "get-sequence-count": { file: "get-sequence-count.jsx", fn: "ppb_getSequenceCount" },
  "get-total-clip-count": { file: "get-total-clip-count.jsx", fn: "ppb_getTotalClipCount" },
  "get-target-tracks": { file: "get-target-tracks.jsx", fn: "ppb_getTargetTracks" },
  "get-track-info": { file: "get-track-info.jsx", fn: "ppb_getTrackInfo" },
  "get-encoder-presets": { file: "get-encoder-presets.jsx", fn: "ppb_getEncoderPresets" },
  "get-qe-clip-info": { file: "get-qe-clip-info.jsx", fn: "ppb_getQeClipInfo" },
  "get-source-monitor-info": { file: "get-source-monitor-info.jsx", fn: "ppb_getSourceMonitorInfo" },
  "get-clip-adjustment-layer": { file: "get-clip-adjustment-layer.jsx", fn: "ppb_getClipAdjustmentLayer" },
  "add-marker": { file: "add-marker.jsx", fn: "ppb_addMarker" },
  "update-marker": { file: "update-marker.jsx", fn: "ppb_updateMarker" },
  "delete-marker": { file: "delete-marker.jsx", fn: "ppb_deleteMarker" },
  "add-marker-to-project-item": { file: "add-marker-to-project-item.jsx", fn: "ppb_addMarkerToProjectItem" },
  "redo": { file: "redo.jsx", fn: "ppb_redo" },
  "undo": { file: "undo.jsx", fn: "ppb_undo" },
  "move-playhead-to-edit": { file: "move-playhead-to-edit.jsx", fn: "ppb_movePlayheadToEdit" },
  "set-poster-frame": { file: "set-poster-frame.jsx", fn: "ppb_setPosterFrame" },
  "select-project-item": { file: "select-project-item.jsx", fn: "ppb_selectProjectItem" },
  "select-clips-by-name": { file: "select-clips-by-name.jsx", fn: "ppb_selectClipsByName" },
  "select-all-clips": { file: "select-all-clips.jsx", fn: "ppb_selectAllClips" },
  "deselect-all-clips": { file: "deselect-all-clips.jsx", fn: "ppb_deselectAllClips" },
  "select-clips-in-range": { file: "select-clips-in-range.jsx", fn: "ppb_selectClipsInRange" },
  "select-clips-by-color": { file: "select-clips-by-color.jsx", fn: "ppb_selectClipsByColor" },
  "invert-selection": { file: "invert-selection.jsx", fn: "ppb_invertSelection" },
  "select-disabled-clips": { file: "select-disabled-clips.jsx", fn: "ppb_selectDisabledClips" },
  "set-clip-selection": { file: "set-clip-selection.jsx", fn: "ppb_setClipSelection" },
  "add-track": { file: "add-track.jsx", fn: "ppb_addTrack" },
  "lock-track": { file: "lock-track.jsx", fn: "ppb_lockTrack" },
  "set-track-visibility": { file: "set-track-visibility.jsx", fn: "ppb_setTrackVisibility" },
  "set-track-mute": { file: "set-track-mute.jsx", fn: "ppb_setTrackMute" },
  "rename-track": { file: "rename-track.jsx", fn: "ppb_renameTrack" },
  "set-target-track": { file: "set-target-track.jsx", fn: "ppb_setTargetTrack" },
  "set-all-tracks-targeted": { file: "set-all-tracks-targeted.jsx", fn: "ppb_setAllTracksTargeted" },
  "set-clip-position": { file: "set-clip-position.jsx", fn: "ppb_setClipPosition" },
  "set-clip-scale": { file: "set-clip-scale.jsx", fn: "ppb_setClipScale" },
  "set-clip-rotation": { file: "set-clip-rotation.jsx", fn: "ppb_setClipRotation" },
  "set-clip-anchor-point": { file: "set-clip-anchor-point.jsx", fn: "ppb_setClipAnchorPoint" },
  "set-clip-opacity": { file: "set-clip-opacity.jsx", fn: "ppb_setClipOpacity" },
  "set-uniform-scale": { file: "set-uniform-scale.jsx", fn: "ppb_setUniformScale" },
  "set-scale-width-height": { file: "set-scale-width-height.jsx", fn: "ppb_setScaleWidthHeight" },
  "set-anti-alias-quality": { file: "set-anti-alias-quality.jsx", fn: "ppb_setAntiAliasQuality" },
  "set-blend-mode": { file: "set-blend-mode.jsx", fn: "ppb_setBlendMode" },
  "apply-effect": { file: "apply-effect.jsx", fn: "ppb_applyEffect" },
  "apply-audio-effect": { file: "apply-audio-effect.jsx", fn: "ppb_applyAudioEffect" },
  "remove-effect": { file: "remove-effect.jsx", fn: "ppb_removeEffect" },
  "remove-effect-by-name": { file: "remove-effect-by-name.jsx", fn: "ppb_removeEffectByName" },
  "remove-all-effects": { file: "remove-all-effects.jsx", fn: "ppb_removeAllEffects" },
  "color-correct": { file: "color-correct.jsx", fn: "ppb_colorCorrect" },
  "apply-lut": { file: "apply-lut.jsx", fn: "ppb_applyLut" },
  "stabilize-clip": { file: "stabilize-clip.jsx", fn: "ppb_stabilizeClip" },
  "copy-effects-between-clips": { file: "copy-effects-between-clips.jsx", fn: "ppb_copyEffectsBetweenClips" },
  "copy-effect-values": { file: "copy-effect-values.jsx", fn: "ppb_copyEffectValues" },
  "batch-apply-effect": { file: "batch-apply-effect.jsx", fn: "ppb_batchApplyEffect" },
  "add-to-timeline": { file: "add-to-timeline.jsx", fn: "ppb_addToTimeline" },
  "remove-from-timeline": { file: "remove-from-timeline.jsx", fn: "ppb_removeFromTimeline" },
  "move-clip": { file: "move-clip.jsx", fn: "ppb_moveClip" },
  "trim-clip": { file: "trim-clip.jsx", fn: "ppb_trimClip" },
  "split-clip": { file: "split-clip.jsx", fn: "ppb_splitClip" },
  "duplicate-clip": { file: "duplicate-clip.jsx", fn: "ppb_duplicateClip" },
  "replace-clip": { file: "replace-clip.jsx", fn: "ppb_replaceClip" },
  "set-clip-speed": { file: "set-clip-speed.jsx", fn: "ppb_setClipSpeed" },
  "get-clip-speed": { file: "get-clip-speed.jsx", fn: "ppb_getClipSpeed" },
  "import-media": { file: "import-media.jsx", fn: "ppb_importMedia" },
  "import-folder": { file: "import-folder.jsx", fn: "ppb_importFolder" },
  "import-image-sequence": { file: "import-image-sequence.jsx", fn: "ppb_importImageSequence" },
  "create-bin": { file: "create-bin.jsx", fn: "ppb_createBin" },
  "rename-bin": { file: "rename-bin.jsx", fn: "ppb_renameBin" },
  "move-items-to-bin": { file: "move-items-to-bin.jsx", fn: "ppb_moveItemsToBin" },
  "relink-media": { file: "relink-media.jsx", fn: "ppb_relinkMedia" },
  "refresh-media": { file: "refresh-media.jsx", fn: "ppb_refreshMedia" },
  "set-item-offline": { file: "set-item-offline.jsx", fn: "ppb_setItemOffline" },
  "detach-proxy": { file: "detach-proxy.jsx", fn: "ppb_detachProxy" },
  "set-override-frame-rate": { file: "set-override-frame-rate.jsx", fn: "ppb_setOverrideFrameRate" },
  "set-override-pixel-aspect-ratio": { file: "set-override-pixel-aspect-ratio.jsx", fn: "ppb_setOverridePixelAspectRatio" },
  "set-scale-to-frame-size": { file: "set-scale-to-frame-size.jsx", fn: "ppb_setScaleToFrameSize" },
  "set-item-start-time": { file: "set-item-start-time.jsx", fn: "ppb_setItemStartTime" },
  "rename-project-item": { file: "rename-project-item.jsx", fn: "ppb_renameProjectItem" }
};

// Files already evalFile'd this panel session. Deliberately keyed on this
// object — which resets every time index.jsx re-evaluates (i.e. on every
// panel load/reload) — and NOT on `typeof ppb_xxx === "function"`: if the
// ExtendScript engine outlives a panel reload, a stale function from the
// previous session would otherwise mask a newer command file on disk and
// break the edit-file → reload-panel dev loop.
var PPB_LOADED = {};

// Single entry point called by the panel (main.js) for every command:
//   ppb_dispatch('<command-name>', '<argsJson>')
// Loads host/commands/<file> on first use, then calls the command function
// with argsJson. The plugin's root directory comes from args.pluginDir,
// which main.js injects into every command's args ($.fileName doesn't
// resolve reliably for a manifest-loaded .jsx, so the panel supplies it).
function ppb_dispatch(commandName, argsJson) {
  try {
    var entry = PPB_COMMANDS[commandName];
    if (!entry) {
      return JSON.stringify({ ok: false, error: "unknown command: " + commandName });
    }

    if (!PPB_LOADED[entry.file]) {
      var pluginDir = null;
      try {
        pluginDir = JSON.parse(argsJson).pluginDir;
      } catch (e) {
        return JSON.stringify({ ok: false, error: "invalid args JSON: " + e.toString() });
      }
      if (!pluginDir || typeof pluginDir !== "string") {
        return JSON.stringify({ ok: false, error: "pluginDir was not provided by the panel" });
      }

      var commandFile = new File(pluginDir + "/host/commands/" + entry.file);
      if (!commandFile.exists) {
        return JSON.stringify({ ok: false, error: "command file not found: " + commandFile.fsName });
      }

      // Drop any stale copy from a previous panel session first, so the
      // eval() lookup below can only resolve the freshly-loaded function
      // (never a leftover global masking a broken/edited file on disk).
      try {
        delete $.global[entry.fn];
      } catch (e) {
        // best-effort
      }

      try {
        $.evalFile(commandFile.fsName);
      } catch (e) {
        return JSON.stringify({ ok: false, error: "failed to load " + entry.file + ": " + e.toString() });
      }

      // $.evalFile evaluates the file in the CALLING scope (confirmed
      // live 2026-07-17): its function declarations land in this
      // function's local scope, NOT on $.global. Resolve the command's
      // entry point from the local scope and publish it globally — the
      // closure keeps the file's sibling helper functions reachable from
      // it, and each file's helpers stay isolated in their own load
      // scope. Do NOT trust a pre-existing $.global[entry.fn] here: if
      // the ExtendScript engine outlives a panel reload, that global is
      // a stale copy from an earlier session masking the file on disk.
      var loadedFn = null;
      try {
        loadedFn = eval(entry.fn);
      } catch (e) {
        loadedFn = null;
      }
      if (typeof loadedFn !== "function") {
        return JSON.stringify({ ok: false, error: entry.file + " loaded but did not define " + entry.fn + "()" });
      }
      $.global[entry.fn] = loadedFn;

      PPB_LOADED[entry.file] = true;
    }

    return $.global[entry.fn](argsJson);
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
