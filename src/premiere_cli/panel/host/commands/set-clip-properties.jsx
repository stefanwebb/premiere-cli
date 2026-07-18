// Command: set-clip-properties → ppb_setClipProperties
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (findSequenceByName,
// ...) are already defined there.
//
// Standard-DOM mutation. Ported from leancoderkavy's premiere-pro-mcp
// `set_clip_properties` tool (timeline.ts) — a thin composition over the
// same Motion/Opacity-component property lookups used by the individual
// set-clip-* commands (set_clip_opacity/scale/position/rotation in
// advanced.ts), bundled into one bulk call as the reference tool does.
// Only properties the reference tool itself supports are included: opacity
// (0-100), speed (multiplier, e.g. 1.0 = normal — passed to
// clip.setSpeed(speed*100) matching the reference's percent conversion),
// scale, positionX/positionY (Motion "Position", set together as [x,y] —
// if only one is given, the OTHER axis's current value is read first and
// preserved), and rotation (degrees). Every requested property gets its
// own {previousValue, requestedValue, newValue, verified} entry; a
// property that isn't requested is left completely untouched.
function ppb_setClipPropertiesFindMotionProperty(clip, displayName) {
  try {
    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      var compName = null;
      var compMatch = null;
      try { compName = comp.displayName; } catch (e) { compName = null; }
      try { compMatch = comp.matchName; } catch (e) { compMatch = null; }
      if (compName === "Motion" || compMatch === "AE.ADBE Motion") {
        for (var p = 0; p < comp.properties.numItems; p++) {
          var propName = null;
          try { propName = comp.properties[p].displayName; } catch (e) { propName = null; }
          if (propName === displayName) {
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

function ppb_setClipPropertiesFindOpacityProperty(clip) {
  try {
    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      var compName = null;
      var compMatch = null;
      try { compName = comp.displayName; } catch (e) { compName = null; }
      try { compMatch = comp.matchName; } catch (e) { compMatch = null; }
      if (compName === "Opacity" || compMatch === "AE.ADBE Opacity") {
        for (var p = 0; p < comp.properties.numItems; p++) {
          var propName = null;
          try { propName = comp.properties[p].displayName; } catch (e) { propName = null; }
          if (propName === "Opacity") {
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

function ppb_setClipPropertiesApplyScalar(prop, requestedValue, results, fieldName) {
  if (!prop) {
    results[fieldName] = { requestedValue: requestedValue, error: "property not found on clip" };
    return;
  }
  var previousValue = null;
  try { previousValue = prop.getValue(); } catch (e) { previousValue = null; }
  var entry = { previousValue: previousValue, requestedValue: requestedValue, newValue: null, verified: false };
  try {
    prop.setValue(requestedValue, true);
  } catch (e) {
    entry.error = e.toString();
    results[fieldName] = entry;
    return;
  }
  try { entry.newValue = prop.getValue(); } catch (e) { entry.newValue = null; }
  entry.verified = entry.newValue !== null && Math.abs(entry.newValue - requestedValue) < 0.001;
  results[fieldName] = entry;
}

function ppb_setClipProperties(argsJson) {
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

    var hasOpacity = typeof args.opacity === "number";
    var hasSpeed = typeof args.speed === "number";
    var hasScale = typeof args.scale === "number";
    var hasPositionX = typeof args.positionX === "number";
    var hasPositionY = typeof args.positionY === "number";
    var hasRotation = typeof args.rotation === "number";

    if (!hasOpacity && !hasSpeed && !hasScale && !hasPositionX && !hasPositionY && !hasRotation) {
      return JSON.stringify({ ok: false, error: "at least one of opacity, speed, scale, positionX, positionY, rotation is required" });
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
    var clipName = null;
    try { clipName = clip.name; } catch (e) { clipName = null; }

    var changes = {};

    if (hasOpacity) {
      ppb_setClipPropertiesApplyScalar(ppb_setClipPropertiesFindOpacityProperty(clip), args.opacity, changes, "opacity");
    }

    if (hasSpeed) {
      var speedEntry = { requestedValue: args.speed, newValue: null, verified: false };
      try { speedEntry.previousValue = clip.getSpeed(); } catch (e) { speedEntry.previousValue = null; }
      try {
        clip.setSpeed(args.speed * 100);
      } catch (e) {
        speedEntry.error = e.toString();
      }
      try { speedEntry.newValue = clip.getSpeed(); } catch (e) { speedEntry.newValue = null; }
      speedEntry.verified = speedEntry.newValue !== null && Math.abs(speedEntry.newValue - args.speed) < 0.001;
      changes.speed = speedEntry;
    }

    if (hasScale) {
      ppb_setClipPropertiesApplyScalar(ppb_setClipPropertiesFindMotionProperty(clip, "Scale"), args.scale, changes, "scale");
    }

    if (hasRotation) {
      ppb_setClipPropertiesApplyScalar(ppb_setClipPropertiesFindMotionProperty(clip, "Rotation"), args.rotation, changes, "rotation");
    }

    if (hasPositionX || hasPositionY) {
      var posProp = ppb_setClipPropertiesFindMotionProperty(clip, "Position");
      if (!posProp) {
        changes.position = { error: "Position property not found on clip's Motion component" };
      } else {
        var previousPos = null;
        try { previousPos = posProp.getValue(); } catch (e) { previousPos = null; }
        var px = previousPos && previousPos.length >= 2 ? previousPos[0] : 0;
        var py = previousPos && previousPos.length >= 2 ? previousPos[1] : 0;
        if (hasPositionX) { px = args.positionX; }
        if (hasPositionY) { py = args.positionY; }

        var posEntry = { previousValue: previousPos, requestedValue: [px, py], newValue: null, verified: false };
        try {
          posProp.setValue([px, py], true);
        } catch (e) {
          posEntry.error = e.toString();
        }
        try { posEntry.newValue = posProp.getValue(); } catch (e) { posEntry.newValue = null; }
        posEntry.verified = posEntry.newValue !== null && posEntry.newValue.length >= 2 &&
          Math.abs(posEntry.newValue[0] - px) < 0.001 && Math.abs(posEntry.newValue[1] - py) < 0.001;
        changes.position = posEntry;
      }
    }

    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      trackIndex: args.trackIndex,
      clipIndex: args.clipIndex,
      clipName: clipName,
      changes: changes
    };

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
