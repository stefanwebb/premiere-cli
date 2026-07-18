// Command: debug-qe-inspect → ppb_debugQeInspect
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled, ...)
// are already defined there.
//
// TEMPORARY / EXPERIMENTAL — discovery-only command, not a supported panel
// feature. QE (Quality Engineering) DOM clip objects are undocumented and
// their method surface is unconfirmed on this Premiere Pro version. This
// reflects on whatever it finds (candidate method names checked via typeof,
// plus a for-in enumeration) so we can learn the real API before attempting
// to build unlink/delete/move/relink on top of it. Remove or promote once
// that's answered.
var QE_CANDIDATE_METHODS = [
  "remove", "removeItem", "removeClip",
  "unlink", "link", "isLinked",
  "move", "moveClip", "moveItem",
  "insertClip", "overwriteClip",
  "setStart", "setEnd", "setInPoint", "setOutPoint",
  "extractAndAlign", "getSpeed", "setSpeed",
  "cut", "copy", "paste", "duplicate",
  "select", "isSelected", "setSelected"
];

var QE_CANDIDATE_PROPERTIES = [
  "name", "type", "start", "end", "duration", "inPoint", "outPoint",
  "isSelected", "numComponents", "mediaType", "filePath"
];

function reflectQeObject(obj) {
  var info = {
    availableMethods: [], availableProperties: {}, forInKeys: [],
    reflectMethods: null, reflectProperties: null
  };

  if (!obj) {
    return info;
  }

  // ExtendScript's built-in Reflection mechanism — when a host object
  // exposes .reflect, this is authoritative (the real API), unlike the
  // candidate-name guessing and for-in enumeration below.
  try {
    if (obj.reflect) {
      if (obj.reflect.methods) {
        info.reflectMethods = [];
        info.reflectMethodDetails = [];
        for (var rm = 0; rm < obj.reflect.methods.length; rm++) {
          var methodDef = obj.reflect.methods[rm];
          info.reflectMethods.push(methodDef.name);

          var detail = { name: methodDef.name, description: null, parameters: [] };
          try {
            detail.description = methodDef.description || null;
          } catch (e) {
            // some hosts throw on .description access — leave null
          }
          try {
            if (methodDef.parameters) {
              for (var pp = 0; pp < methodDef.parameters.length; pp++) {
                var paramDef = methodDef.parameters[pp];
                detail.parameters.push({
                  name: paramDef.name || null,
                  description: paramDef.description || null
                });
              }
            }
          } catch (e) {
            detail.parametersError = e.toString();
          }
          info.reflectMethodDetails.push(detail);
        }
      }
      if (obj.reflect.properties) {
        info.reflectProperties = [];
        for (var rp = 0; rp < obj.reflect.properties.length; rp++) {
          info.reflectProperties.push(obj.reflect.properties[rp].name);
        }
      }
    }
  } catch (e) {
    info.reflectError = e.toString();
  }

  for (var m = 0; m < QE_CANDIDATE_METHODS.length; m++) {
    var methodName = QE_CANDIDATE_METHODS[m];
    try {
      if (typeof obj[methodName] === "function") {
        info.availableMethods.push(methodName);
      }
    } catch (e) {
      // Accessing some properties on QE objects can itself throw — skip.
    }
  }

  for (var p = 0; p < QE_CANDIDATE_PROPERTIES.length; p++) {
    var propName = QE_CANDIDATE_PROPERTIES[p];
    try {
      var value = obj[propName];
      if (typeof value !== "undefined" && typeof value !== "function") {
        info.availableProperties[propName] = String(value);
      }
    } catch (e) {
      // Skip properties that throw on access.
    }
  }

  try {
    for (var key in obj) {
      info.forInKeys.push(key);
    }
  } catch (e) {
    info.forInKeysError = e.toString();
  }

  return info;
}

function ppb_debugQeInspect() {
  try {
    if (!app.project) {
      return JSON.stringify({ ok: false, error: "no project open" });
    }

    try {
      ensureQEEnabled();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "app.enableQE() failed: " + e.toString() });
    }

    if (typeof qe === "undefined" || !qe.project) {
      return JSON.stringify({ ok: false, error: "QE DOM not available after enableQE()" });
    }

    var qeSeq;
    try {
      qeSeq = qe.project.getActiveSequence();
    } catch (e) {
      return JSON.stringify({ ok: false, error: "qe.project.getActiveSequence() failed: " + e.toString() });
    }

    if (!qeSeq) {
      return JSON.stringify({ ok: false, error: "no active sequence (open/select a sequence tab in Premiere)" });
    }

    var result = {
      sequenceReflection: reflectQeObject(qeSeq),
      numVideoTracks: null,
      numAudioTracks: null,
      video: null,
      audio: null
    };

    try {
      result.numVideoTracks = qeSeq.numVideoTracks;
    } catch (e) {
      result.numVideoTracksError = e.toString();
    }

    try {
      result.numAudioTracks = qeSeq.numAudioTracks;
    } catch (e) {
      result.numAudioTracksError = e.toString();
    }

    // Scans every track of one media type for the first item whose type
    // isn't "Empty" (an Empty item is just a gap placeholder, not a real
    // clip) — track 0's first item may well be a gap, as it was here.
    function findFirstRealClip(getTrackFn, numTracks, label) {
      var scanInfo = { tracksScanned: 0, trackReflection: null, foundAt: null, clipReflection: null, itemsSeen: [] };

      for (var t = 0; t < numTracks; t++) {
        var track;
        try {
          track = getTrackFn(t);
        } catch (e) {
          scanInfo.itemsSeen.push({ track: t, error: label + " track fetch failed: " + e.toString() });
          continue;
        }

        if (!track) {
          continue;
        }

        scanInfo.tracksScanned++;
        if (scanInfo.trackReflection === null) {
          scanInfo.trackReflection = reflectQeObject(track);
        }

        var numItems;
        try {
          numItems = track.numItems;
        } catch (e) {
          scanInfo.itemsSeen.push({ track: t, error: "numItems failed: " + e.toString() });
          continue;
        }

        for (var i = 0; i < numItems; i++) {
          var item;
          try {
            item = track.getItemAt(i);
          } catch (e) {
            scanInfo.itemsSeen.push({ track: t, item: i, error: e.toString() });
            continue;
          }

          var itemType = null;
          try {
            itemType = item.type;
          } catch (e) {
            itemType = "<unreadable>";
          }
          scanInfo.itemsSeen.push({ track: t, item: i, type: itemType });

          if (scanInfo.foundAt === null && itemType !== "Empty") {
            scanInfo.foundAt = { track: t, item: i };
            scanInfo.clipReflection = reflectQeObject(item);
          }
        }
      }

      return scanInfo;
    }

    try {
      result.video = findFirstRealClip(
        function (i) { return qeSeq.getVideoTrackAt(i); },
        result.numVideoTracks || 0,
        "video"
      );
    } catch (e) {
      result.video = { error: e.toString() };
    }

    try {
      result.audio = findFirstRealClip(
        function (i) { return qeSeq.getAudioTrackAt(i); },
        result.numAudioTracks || 0,
        "audio"
      );
    } catch (e) {
      result.audio = { error: e.toString() };
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
