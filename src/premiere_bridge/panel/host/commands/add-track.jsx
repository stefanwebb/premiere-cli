// Command: add-track → ppb_addTrack
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (ensureQEEnabled,
// findSequenceByName, ...) are already defined there.
//
// Merges leancoderkavy's premiere-pro-mcp `add_track` (tracks.ts, standard
// DOM insertVideoTrackAt/insertAudioTrackAt) and `add_tracks` (advanced.ts,
// QE addTracks) into one command — the reference project split these into
// two near-duplicate tools (single-track-type standard-DOM vs. multi-type
// QE); here `trackType` picks video-or-audio and `count` picks how many.
//
// hetpatel's note in PREMIERE_API_NOTES.md warns that a bulk QE addTracks()
// call can WEDGE the CEP bridge — so even when the QE fallback path is
// used, this issues exactly one underlying add call per requested track,
// in a loop, never a single call with count > 1.
function ppb_addTrack(argsJson) {
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

    var count = 1;
    if (args.count !== undefined && args.count !== null) {
      if (typeof args.count !== "number" || Math.floor(args.count) !== args.count || args.count < 1) {
        return JSON.stringify({ ok: false, error: "count must be a positive integer" });
      }
      count = args.count;
    }
    if (count > 8) {
      count = 8; // capped — see task spec; guards against a runaway bulk-insert loop
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

    function getTrackCollection() {
      return args.trackType === "video" ? seq.videoTracks : seq.audioTracks;
    }

    var index = args.index;
    var hasIndex = typeof index === "number" && Math.floor(index) === index && index >= 0;

    var attemptsLog = [];
    var addedCount = 0;
    var startingCount = getTrackCollection().numTracks;

    for (var i = 0; i < count; i++) {
      var before = getTrackCollection().numTracks;
      var insertAt = hasIndex ? index : before; // default: append at the end
      var iterationAttempts = [];
      var succeeded = false;

      // --- Attempt 1: standard-DOM insertVideoTrackAt/insertAudioTrackAt [leancoderkavy] ---
      try {
        if (args.trackType === "video") {
          seq.insertVideoTrackAt(insertAt, 1);
        } else {
          seq.insertAudioTrackAt(insertAt, 1);
        }
        iterationAttempts.push({ form: "insertTrackAt", success: true });
        succeeded = getTrackCollection().numTracks > before;
      } catch (e) {
        iterationAttempts.push({ form: "insertTrackAt", success: false, error: e.toString() });
      }

      // --- Attempt 2: seq.addTrack(type[, channelType]) [ayushozha] ---
      if (!succeeded) {
        try {
          if (args.trackType === "video") {
            seq.addTrack("video");
          } else {
            seq.addTrack("audio", 1 /* stereo */);
          }
          iterationAttempts.push({ form: "addTrack", success: true });
          succeeded = getTrackCollection().numTracks > before;
        } catch (e) {
          iterationAttempts.push({ form: "addTrack", success: false, error: e.toString() });
        }
      }

      // --- Attempt 3: QE addTracks(...), one track per call (never bulk) ---
      if (!succeeded) {
        try {
          ensureQEEnabled();
          if (app.project.activeSequence !== seq) {
            app.project.activeSequence = seq;
          }
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) {
            throw new Error("qe.project.getActiveSequence() returned nothing");
          }
          if (args.trackType === "video") {
            // hetpatel 7-arg form: (videoCount, videoInsertIndex, audioCount, audioInsertIndex, audioMediaType, submixCount, submixInsertIndex)
            qeSeq.addTracks(1, insertAt, 0, 0, 1, 0, 0);
          } else {
            // hetpatel 7-arg form, audio side
            qeSeq.addTracks(0, 0, 1, insertAt, 1, 0, 0);
          }
          iterationAttempts.push({ form: "qeAddTracks7Arg", success: true });
          succeeded = getTrackCollection().numTracks > before;
        } catch (e) {
          iterationAttempts.push({ form: "qeAddTracks7Arg", success: false, error: e.toString() });
        }
      }

      // --- Attempt 4: QE addTracks(...) leancoderkavy's 4-arg form, one track per call ---
      if (!succeeded) {
        try {
          ensureQEEnabled();
          if (app.project.activeSequence !== seq) {
            app.project.activeSequence = seq;
          }
          var qeSeq2 = qe.project.getActiveSequence();
          if (!qeSeq2) {
            throw new Error("qe.project.getActiveSequence() returned nothing");
          }
          if (args.trackType === "video") {
            qeSeq2.addTracks(1, 0, 0, 0);
          } else {
            qeSeq2.addTracks(0, 1, 0, 0);
          }
          iterationAttempts.push({ form: "qeAddTracks4Arg", success: true });
          succeeded = getTrackCollection().numTracks > before;
        } catch (e) {
          iterationAttempts.push({ form: "qeAddTracks4Arg", success: false, error: e.toString() });
        }
      }

      attemptsLog.push({ trackNumber: i + 1, attempts: iterationAttempts, succeeded: succeeded });

      if (succeeded) {
        addedCount++;
      } else {
        // Stop retrying further tracks once one iteration fails outright —
        // no known form worked, so more attempts at the same op would just
        // repeat the same failures.
        break;
      }
    }

    var finalCount = getTrackCollection().numTracks;
    var result = {
      sequenceName: seq.name,
      trackType: args.trackType,
      requestedCount: count,
      added: addedCount,
      startingTrackCount: startingCount,
      totalTracks: finalCount,
      attempts: attemptsLog
    };

    if (addedCount === 0) {
      return JSON.stringify({
        ok: false,
        error: "could not add any " + args.trackType + " track with any known form (insertTrackAt, addTrack, QE addTracks 7-arg, QE addTracks 4-arg)",
        attempts: attemptsLog
      });
    }
    if (addedCount < count) {
      result.warning = "only added " + addedCount + " of " + count + " requested tracks before a failure";
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
