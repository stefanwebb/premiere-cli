# Live-tested API findings — Premiere Pro 2026 (26.3.0, macOS)

Consolidated results from the 2026-07-17 live-testing sessions that
accompanied the command port (~210 commands built across 6 waves, each
wave smoke-tested against a real project through the Premiere Bridge
panel), plus the same-day follow-up probe session driven by two newly
studied MCP repos (see the addendum in PREMIERE_API_NOTES.md).
Everything here was observed on THIS machine's build — Premiere Pro
26.3.0 — and is version-specific by nature. Re-verify after any Premiere
upgrade.

Sibling documents: [PREMIERE_API_NOTES.md](PREMIERE_API_NOTES.md) (what
open-source MCP repos claim, from research), and
[QE_DOM_NOTES.md](QE_DOM_NOTES.md) (earlier QE-discovery sessions). This
file records what actually happened when we ran things.

## MAJOR CORRECTIONS (2026-07-17 probe session)

Five entries in the "non-functional" table below were overturned by the
follow-up probe session. The corrected findings:

- **`qe.project.undo()` / `qe.project.redo()` WORK** for operations that
  enter the undo stack. The original "silent no-op" conclusion was an
  artifact of testing with marker-add and track-rename — live-verified
  via `qe.project.undoStackIndex()` (exists on this build, returns an
  int) that **those operations never enter the undo stack at all**.
  A `qeClip.setSpeed()` mutation pushed the stack (158→159), `undo()`
  popped it and reverted the speed, `redo()` re-applied it — all
  read-back-verified. **DANGER**: calling `undo()` after an operation
  that did NOT enter the stack pops whatever IS on top — potentially the
  user's own last edit (this happened during probing: an undo after a
  marker-add silently removed a previously placed clip instead). Always
  bracket undo with `undoStackIndex()` readings.
- **`qeClip.setSpeed()` WORKS** with the 5-arg signature
  `setSpeed(speedMultiplier, ticksString, reverse, bool?, bool?)`:
  arg1 is a **multiplier** (1 = 100%; `getSpeed()` reads back the same
  scale — a normal clip reads `1`, not `100`); arg2 must be a
  plausible ticks string (passing garbage like the literal `"ticks"`
  collapses the clip to ONE FRAME; pass the clip's current duration in
  ticks); arg3 is the **reverse** flag (verified via
  `isSpeedReversed()`); args 4/5 unknown (false/false is safe). On
  speed-up the timeline item shortens to source/speed **rounded up to
  whole frames** (`getSpeed()` then reads the post-rounding actual, e.g.
  48.5 for a requested 50); on slow-down the item does NOT extend
  (source usage truncates instead). Negative speeds don't reverse — they
  clamp to something degenerate; use arg3.
- **`qeClip.moveToTrack()` WORKS** with the 4-arg form
  `moveToTrack(videoTrackOffset, audioTrackOffset, "0", false)` —
  RELATIVE track offsets (target − source), time-shift as a ticks
  string. It is a TRUE move: effects/keyframes survive (verified with a
  Gaussian Blur) and the start time is preserved. Found in the
  antipaster repo. Supersedes the lossy remove+overwrite workaround.
- **Track-object placement honors the track**:
  `seq.videoTracks[i].insertClip(projectItem, TimeObject)` and
  `.overwriteClip(projectItem, TimeObject)` (methods on the TRACK, not
  the sequence) place the clip on exactly that track — verified on
  tracks 1 and 2, no linked-audio side effects with an audio-less
  source. This sidesteps the sequence-level track-index bug below.
- **`qe.project.newBarsAndTone(width, height)` WORKS** (2-arg QE form,
  from the antipaster repo) — created an "HD Bars and Tone" project item,
  verified by project-tree diff. The standard-DOM
  `app.project.newBarsAndTone(...)` remains broken.

New negative findings from the same session:

- **`qe.project.undoStackManager` does NOT exist** (antipaster uses it on
  Windows; absent here).
- **`app.findMenuCommandId` / `app.executeCommand` / `qe.executeCommand`
  are all `undefined` in this CEP ExtendScript context** — the
  menu-command escape hatch (hetpatel's route to Undo/Lift/Extract) is
  unavailable.
- **`app.project.deleteAsset` is not a function** on this build.
  To delete project items from script: `item.moveBin(bin)` them into a
  scratch bin, then `bin.deleteBin()` (recursive) — live-verified.
- **`qe.project.newAdjustmentLayer` remains absent** (typeof undefined;
  0/2/3-arg forms all moot).

## Non-functional APIs (confirmed broken on this build)

| API | Symptom | Command affected / workaround |
|---|---|---|
| `app.project.undo()` | does not exist ("is not a function") | `undo` falls back to QE — see next row |
| `qe.project.undo()` | ~~silent no-op~~ **CORRECTED — see above**: works for stack-entering ops; markers/track-renames never enter the stack | `undo`/`redo` are implementable with `undoStackIndex()` verification |
| `qe.project.redo()` | ~~presumed no-op~~ **CORRECTED — see above**: works, verified | |
| `component.remove()` | silent no-op — effects survive "successful" removals | `remove-effect`/`remove-effect-by-name` hard-fail honestly; `remove-all-effects` (QE `removeEffects()`) is PARTIAL: stripped a Gaussian Blur but refused Lumetri Color. **Effect application is effectively one-way** for some effects |
| `qeClip.setSpeed(...)` | ~~every known signature throws~~ **CORRECTED — see above**: the 5-arg `(multiplier, ticksString, reverse, false, false)` form works | `set-clip-speed`, `reverse-clip` — fixable |
| `qeClip.roll(...)` | all argument forms fail | `roll-edit` — OPEN issue (slip/slide DO no-throw with ticksString) |
| `qeSeq.lift()` | does not exist | `lift-selection` hard-fails; use `remove-selected-clips` |
| `qeSeq.extract()` | no-throws, removes nothing | `extract-selection` hard-fails; use `remove-selected-clips --ripple true` |
| `seq.createSubsequence()` | no-throws, creates nothing (sequence count unchanged) | `create-subsequence`; use selection-based `nest-clips` (works) |
| `seq.getSettings()→mutate→setSettings()` | settings don't apply (fps read back unchanged) — confirms the create-sequence-era finding | `set-sequence-settings` reports per-field applied/failed truthfully |
| `seq.isWorkAreaBarEnabled()` + work area writes | API absent; `setWorkAreaInPoint/OutPoint` no-throw but nothing applies, reads stay null — the work area bar appears dropped in PPro 2026 | `is-work-area-enabled`, `set/get-work-area` (setter carries an `applied` readback flag) |
| poster-frame setters (all candidate names) | none exist | `set-poster-frame` returns the probe-failure error |
| `qe.project.newAdjustmentLayer()` | not available (and legacy `qeSeq.addAdjustmentLayer` was removed in 2026 per the notes) | `add-adjustment-layer` — OPEN issue |
| `app.project.newBarsAndTone(...)` | "Illegal Parameter type" with the documented signature | `create-bars-and-tone` — **fixed by the QE 2-arg form, see corrections above** |
| `qeClip.moveToTrack(...)` | ~~fails every arity~~ **CORRECTED — see above**: 4-arg `(vOff, aOff, "0", false)` with RELATIVE offsets works, losslessly | `move-clip-to-track` — fixable (drops the lossy remove+overwrite path) |
| `clip.markers` (TrackItem marker collection) | undefined | `get-clip-markers` falls back to `projectItem.getMarkers()` (reports `markerSource`) |
| Lumetri "Input LUT" written via `setValue(int)` | **writes and reads back "verified", but the RENDER DOES NOT CHANGE** — live-tested 2026-07-23 by sweeping the index 0/1/2/3 on one clip and exporting a frame each time: all four frames were byte-identical (max diff 0 over 8.3M px). Also confirmed in reverse: a clip whose LUT was chosen in the UI kept rendering that LUT after the property was set to 0 | Treat Input LUT as **UI-only**. The index is meaningful solely as a pointer into a per-instance dropdown that is populated by browsing in the UI; writing it from script mutates a value nothing reads. Cost me several wrong conclusions — a read-back "verified" is NOT evidence of a render change for this param, so verify via `export-frame` instead |
| Lumetri Color's "Input LUT" set to a PATH STRING | "Illegal Parameter type" on all 10 combinations tried (2 same-named properties x 5 argument forms: bare path, path+`true`, `File` object, `File`+`true`, `File.fsName`) | **CORRECTED 2026-07-23 — the param is not un-settable, it is an INTEGER INDEX into Premiere's already-loaded LUT dropdown, not a path.** `set-effect-property --component-name "Lumetri Color" --property-name "Input LUT" --value 1 --value-type number` works and read-back-verifies (live-tested: 1 -> 0 -> verified). So a `.cube` can be selected programmatically ONLY if it is already registered in that dropdown (browse to it once in the UI, or drop it in Premiere's LUT folder); there is still no way to register a NEW file by path from script. `apply-lut` (which sends a string) therefore cannot work as designed — use `set-effect-property` with the index instead |

## APIs that lie (no-throw or wrong return, but effect differs)

- **`seq.insertClip()` / `seq.overwriteClip()` IGNORE their video-track
  index** — clips land on a build-chosen track regardless (tested: index
  0 and 1, active and inactive sequence, targeting on/off, insert and
  overwrite). `add-to-timeline` reports `requestedTrackIndex` vs
  `actualTrackIndex` + `trackHonored`. **Workaround found 2026-07-17**:
  the TRACK object's own `seq.videoTracks[i].insertClip(item,
  TimeObject)` / `.overwriteClip(item, TimeObject)` DO honor the track —
  see the corrections section above.
- **`qeSeq.exportFramePNG()` returns `false` on calls that DID write a
  file**, and silently writes nothing for most "sensible" signatures. The
  working form on this build is `exportFramePNG(path, path)` — the output
  path passed twice. It also writes to `<path>.png` (double extension);
  `export-frame` normalizes the filename and falls back to a one-frame
  AME export.
- **`qeTrack.razor(ticksString)` silently no-ops** — razor ONLY works
  with an `"HH:MM:SS:FF"` timecode string on this build (the form
  `remove-track-intervals` had already proven). `split-clip` and
  `razor-all-tracks` use timecode.
- **`addTransition(null, …)` (the "default transition" form) silently
  adds nothing**, while a NAMED transition (e.g. Cross Dissolve) works
  and verifies. `add-transition` substitutes Cross Dissolve when no name
  is given.
- **`seq.close()` closes only the UI tab** — the sequence remains in
  `app.project.sequences`.
- **Directory enumeration returns empty for some paths** (`/tmp`,
  `/Applications`) from the CEP panel — macOS TCC — even though direct
  file paths ARE readable. Never verify file output by listing a
  directory; check exact candidate paths (see
  `locateAndNormalizeExportedFrame`).

## Confirmed working / calibrated

- **Audio Level dB calibration**: `linear = 10^((dB − 15) / 20)` is EXACT
  on this build (0 dB reads back as 0.177828). All three audio commands
  share it.
- **`seq.setPlayerPosition(ticksString)`** — reliable (export-frame,
  move-playhead).
- **`seq.getInPoint()/getOutPoint()` return SECONDS as a string**, not
  ticks; an unset point reads as the `-400000` sentinel (mapped to null).
  Setting the sentinel via `setInPoint(-400000)` CLEARS the point —
  `clear-sequence-in-out` uses this.
- **Anchor Point values are NORMALIZED 0..1** (0.5, 0.5 = center), not
  pixels, despite the research notes saying pixels.
- **Motion has no "Scale Height" property** — with Uniform Scale off,
  `Scale` IS the height and `Scale Width` is the width.
- **The anti-alias control is Motion's numeric "Anti-flicker Filter"
  (0..1)**, not a boolean.
- **`$.evalFile` evaluates in the CALLING scope**, not globally — the
  lazy command loader must explicitly publish loaded functions to
  `$.global` (see `ppb_dispatch` in index.jsx). A persistent ExtendScript
  engine can also serve STALE functions across panel reloads; the
  dispatcher deletes any pre-existing global before each load.
- **`seq.clone()` rename gotcha confirmed**: `seq.name = x` doesn't
  propagate to the project panel; the sequence's ProjectItem must be
  renamed too (`duplicate-sequence` handles it).
- Live-verified working end-to-end (non-exhaustive): marker lifecycle
  (sequence + project item), timeline selection suite, track
  lock/mute/target/rename/add, clip transform/opacity/flag setters,
  keyframe add/read/remove, apply-effect (one-way!), named transitions
  add/remove, split/razor/ripple-delete/move/duplicate/replace/overwrite
  placements, nest-clips, bins + import-media + subclips +
  move-items-to-bin, duplicate-sequence, set-active-sequence,
  export-sequence / export-fcp-xml / extract-audio-track / export-frame,
  source-monitor round trip.

## Untested-by-choice (dialog-risk / destructive / fire-and-forget)

`open-project`, `save-project-as`, `import-fcp-xml`, `import-ae-comps`,
`import-sequences-from-project`, AME queue commands
(`add-to-render-queue`, `encode-project-item`, `encode-file`),
`manage-proxies`, `set-item-offline`, `replace-clip-media`,
`scene-edit-detection`, `auto-reframe-sequence`, `freeze-frame`,
MOGRT/text/caption commands, `stabilize-clip`,
`copy-effects-between-clips`, `batch-apply-effect`, `set-clip-pan`
(test clip was mono — no Panner exists on mono clips, so the error path
is correct but the success path is unverified).
