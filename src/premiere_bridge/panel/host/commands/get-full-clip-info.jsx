// Command: get-full-clip-info → ppb_getFullClipInfo
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND,
// findSequenceByName, serializeTrackItem, timeValueToSeconds, ...) are
// already defined there.
//
// Standard-DOM read only (seq.videoTracks[i].clips[j]) — no QE DOM needed,
// no need to activate the sequence tab.

var GET_FULL_CLIP_INFO_MAX_COMPONENTS = 50;
var GET_FULL_CLIP_INFO_MAX_PROPERTIES = 100;

function ppb_serializePropertyForFullClipInfo(prop) {
  var out = { displayName: null, value: null, isTimeVarying: null, keyCount: null };

  try { out.displayName = prop.displayName; } catch (e) { out.displayName = null; }

  try {
    var raw = prop.getValue();
    var str = String(raw);
    out.value = str.length > 200 ? str.substring(0, 200) : str;
  } catch (e) {
    out.value = null;
  }

  try {
    out.isTimeVarying = prop.isTimeVarying();
  } catch (e) {
    out.isTimeVarying = null;
  }

  if (out.isTimeVarying === true) {
    try {
      out.keyCount = prop.getKeys().length;
    } catch (e) {
      out.keyCount = null;
    }
  }

  return out;
}

function ppb_serializeComponentForFullClipInfo(comp) {
  var out = { displayName: null, matchName: null, enabled: null, properties: [] };

  try { out.displayName = comp.displayName; } catch (e) { out.displayName = null; }
  try { out.matchName = comp.matchName; } catch (e) { out.matchName = null; }
  try { out.enabled = comp.enabled; } catch (e) { out.enabled = null; }

  try {
    var numProps = comp.properties.numItems;
    var cap = numProps > GET_FULL_CLIP_INFO_MAX_PROPERTIES ? GET_FULL_CLIP_INFO_MAX_PROPERTIES : numProps;
    for (var p = 0; p < cap; p++) {
      out.properties.push(ppb_serializePropertyForFullClipInfo(comp.properties[p]));
    }
    if (numProps > GET_FULL_CLIP_INFO_MAX_PROPERTIES) {
      out.truncated = true;
    }
  } catch (e) {
    // leave properties as whatever was collected so far
  }

  return out;
}

function ppb_serializeComponentsForFullClipInfo(clip) {
  var components = [];
  var truncated = false;
  try {
    var numComponents = clip.components.numItems;
    var cap = numComponents > GET_FULL_CLIP_INFO_MAX_COMPONENTS ? GET_FULL_CLIP_INFO_MAX_COMPONENTS : numComponents;
    for (var i = 0; i < cap; i++) {
      components.push(ppb_serializeComponentForFullClipInfo(clip.components[i]));
    }
    if (numComponents > GET_FULL_CLIP_INFO_MAX_COMPONENTS) {
      truncated = true;
    }
  } catch (e) {
    // leave components as whatever was collected so far
  }
  return { components: components, truncated: truncated };
}

function ppb_getFullClipInfo(argsJson) {
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

    var trackCollection = args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    var numTracks = trackCollection.numTracks;
    if (args.trackIndex >= numTracks) {
      return JSON.stringify({
        ok: false,
        error: "trackIndex " + args.trackIndex + " is out of range — sequence has " + numTracks + " " + args.trackType + " track(s)"
      });
    }

    var track = trackCollection[args.trackIndex];
    var numClips = track.clips.numItems;
    if (args.clipIndex >= numClips) {
      return JSON.stringify({
        ok: false,
        error: "clipIndex " + args.clipIndex + " is out of range — track " + args.trackIndex + " has " + numClips + " clip(s)"
      });
    }

    var clip = track.clips[args.clipIndex];

    var result = serializeTrackItem(clip, args.trackIndex, args.clipIndex);

    try { result.type = clip.type; } catch (e) { result.type = null; }
    try { result.speed = clip.getSpeed(); } catch (e) { result.speed = null; }
    try { result.isSpeedReversed = clip.isSpeedReversed(); } catch (e) { result.isSpeedReversed = null; }
    try { result.linkedItemsCount = clip.getLinkedItems().numItems; } catch (e) { result.linkedItemsCount = null; }

    result.projectItem = { name: null, treePath: null, nodeId: null };
    try { result.projectItem.name = clip.projectItem.name; } catch (e) { result.projectItem.name = null; }
    try { result.projectItem.treePath = clip.projectItem.treePath; } catch (e) { result.projectItem.treePath = null; }
    try { result.projectItem.nodeId = clip.projectItem.nodeId; } catch (e) { result.projectItem.nodeId = null; }

    var componentsResult = ppb_serializeComponentsForFullClipInfo(clip);
    result.components = componentsResult.components;
    if (componentsResult.truncated) {
      result.truncated = true;
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
