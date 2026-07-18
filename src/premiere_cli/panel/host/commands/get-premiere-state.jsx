// Command: get-premiere-state → ppb_getPremiereState
// Loaded lazily by ppb_dispatch (host/index.jsx) on first use, into the
// same global ExtendScript context — shared helpers (TICKS_PER_SECOND, ...)
// are already defined there.
//
// A full point-in-time snapshot of whatever Premiere Pro state currently
// exists: app version, open project, active sequence, playhead position,
// and current selection. Unlike most other commands, having no project (or
// no active sequence, or no selection) open is NOT an error here — the
// whole point of this command is to truthfully report whatever state
// exists, including "nothing is open right now".

function ppb_getPremiereState() {
  try {
    var result = {
      appVersion: null,
      project: null,
      activeSequence: null,
      playheadSeconds: null,
      selection: null
    };

    try {
      result.appVersion = app.version;
    } catch (e) {
      result.appVersion = null;
    }

    var proj = null;
    try {
      proj = app.project;
    } catch (e) {
      proj = null;
    }

    if (proj) {
      var projectInfo = { name: null, path: null };
      try {
        projectInfo.name = proj.name;
      } catch (e) {
        projectInfo.name = null;
      }
      try {
        projectInfo.path = proj.path;
      } catch (e) {
        projectInfo.path = null;
      }
      result.project = projectInfo;

      var seq = null;
      try {
        seq = proj.activeSequence;
      } catch (e) {
        seq = null;
      }

      if (seq) {
        var seqInfo = {
          name: null,
          sequenceID: null,
          frameRate: null,
          durationSeconds: null,
          width: null,
          height: null
        };
        try {
          seqInfo.name = seq.name;
        } catch (e) {
          seqInfo.name = null;
        }
        try {
          seqInfo.sequenceID = seq.sequenceID;
        } catch (e) {
          seqInfo.sequenceID = null;
        }
        try {
          seqInfo.frameRate = TICKS_PER_SECOND / Number(seq.timebase);
        } catch (e) {
          seqInfo.frameRate = null;
        }
        try {
          seqInfo.durationSeconds = (Number(seq.end) - Number(seq.zeroPoint)) / TICKS_PER_SECOND;
        } catch (e) {
          seqInfo.durationSeconds = null;
        }
        try {
          var settings = seq.getSettings();
          seqInfo.width = settings.videoFrameWidth;
          seqInfo.height = settings.videoFrameHeight;
        } catch (e) {
          seqInfo.width = null;
          seqInfo.height = null;
        }
        result.activeSequence = seqInfo;

        try {
          var pos = seq.getPlayerPosition();
          try {
            result.playheadSeconds = pos.seconds;
          } catch (e2) {
            result.playheadSeconds = Number(pos.ticks) / TICKS_PER_SECOND;
          }
        } catch (e) {
          result.playheadSeconds = null;
        }

        // seq.getSelection() has been seen returning either a plain array
        // (.length) or a TrackItem-collection-style object (.numItems) —
        // probe both defensively rather than assuming one shape.
        try {
          var sel = seq.getSelection();
          var selCount = 0;
          if (sel) {
            if (typeof sel.numItems === "number") {
              selCount = sel.numItems;
            } else if (typeof sel.length === "number") {
              selCount = sel.length;
            }
          }

          var selArray = [];
          for (var i = 0; i < selCount; i++) {
            var item = sel[i];
            var entry = { name: null, mediaType: null, startSeconds: null, endSeconds: null, nodeId: null };
            try {
              entry.name = item.name;
            } catch (e) {
              entry.name = null;
            }
            try {
              entry.mediaType = item.mediaType;
            } catch (e) {
              entry.mediaType = null;
            }
            try {
              entry.startSeconds = item.start.seconds;
            } catch (e) {
              entry.startSeconds = null;
            }
            try {
              entry.endSeconds = item.end.seconds;
            } catch (e) {
              entry.endSeconds = null;
            }
            try {
              entry.nodeId = item.nodeId;
            } catch (e) {
              entry.nodeId = null;
            }
            selArray.push(entry);
          }
          result.selection = selArray;
        } catch (e) {
          // getSelection() itself unavailable/threw — distinct from "nothing selected"
          result.selection = null;
        }
      }
    }

    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}
