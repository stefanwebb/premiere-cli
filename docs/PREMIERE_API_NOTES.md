# Premiere Pro scripting API notes (from studying three MCP repos)

> **See also [BUILD_FINDINGS.md](BUILD_FINDINGS.md)** — consolidated LIVE-TESTED results (2026-07-17) for this machine's build, which supersede this file's research-derived claims wherever they conflict.

Extracted 2026-07 from three open-source Premiere Pro MCP servers, as
reference material for growing our own CEP bridge (`host/index.jsx`):

- **[hetpatel]** `hetpatel-11/Adobe_Premiere_Pro_MCP` — 104 tools, ~43 live-tested; file-based command bridge + CEP evalScript
- **[leancoderkavy]** `leancoderkavy/premiere-pro-mcp` — 269 tools / 28 modules; file-based bridge + CEP evalScript
- **[ayushozha]** `ayushozha/AdobePremiereProMCP` — 1,020 ExtendScript functions; WebSocket server inside CEP panel

A fourth repo was studied 2026-07-17 — see the
[addendum](#2026-07-17-addendum--antipaster--jordanl61-repos) at the
bottom:

- **[antipaster]** `antipaster/Adobe-Premiere-Pro-MCP` — ~170 tools;
  WebSocket (port 8097) → CEP panel, per-domain JSX modules; Windows,
  tested on Premiere 2026 — the closest peer to our build

Everything below is what those repos *actually call*, tagged by source.
Where repos disagree, or contradict our own live tests
(see [QE_DOM_NOTES.md](QE_DOM_NOTES.md)), that's flagged — treat every
signature as version-dependent until verified against our Premiere build.

Two API surfaces exist:
- **Standard DOM** (`app.project...`) — documented-ish, stabler
- **QE DOM** (`app.enableQE(); qe.project...`) — undocumented, needed for
  effects/transitions/razor/speed/track-removal; varies by build

---

## Time: the master rules

- **`TICKS_PER_SECOND = 254016000000`** — the single conversion constant
  (all three repos; matches our `index.jsx`). `seq.timebase` = ticks per
  frame, so `fps = 254016000000 / Number(seq.timebase)`.
- **Ticks travel as STRINGS**: `String(Math.round(seconds * 254016000000))`.
- `Time` object construction:
  ```js
  var t = new Time();
  t.seconds = 12.5;                 // numeric setter
  // or: t.ticks = "3175200000000"; // ticks setter takes a STRING
  // hetpatel also saw: new Time("12.5s") — string-with-s-suffix ctor
  ```
- `clip.start/.end/.inPoint/.outPoint/.duration`, `marker.start/.end`,
  `seq.getPlayerPosition()` return Time objects (`.seconds` number,
  `.ticks` string).
- **QE items use `.secs` not `.seconds`** (`item.start.secs`) [ayushozha].
- Which form a method wants is inconsistent per method — captured inline
  below. Markers want plain **seconds**; `setPlayerPosition` wants a
  **ticks string**; QE `razor` wants a **ticks string** [leancoderkavy,
  ayushozha] or an **HH:MM:SS:FF timecode string** [hetpatel] (version
  difference? verify on ours).

## Sequences

| Operation | Call | Source / caveat |
|---|---|---|
| Create | `app.project.createNewSequence(name)` | may throw yet still create [hetpatel]; on OUR build it pops the New Sequence dialog — we use QE `qe.project.newSequence(name, presetPath)` instead (confirmed) |
| Create from preset | `app.project.createNewSequenceFromPreset(name, sqpresetPath)` | [leancoderkavy]; did not exist on our build (we tested `importSequencePreset` — gone) |
| Create from clips | `app.project.createNewSequenceFromClips(name, itemsArray[, targetBin])` | auto-detects settings from first clip [leancoderkavy, ayushozha] |
| Activate | `app.project.activeSequence = seq` or `app.project.openSequence(seq.sequenceID)` or `seq.openInTimeline()` | all three |
| Find | linear scan `app.project.sequences[i]` matching `.sequenceID`/`.name` | "Premiere 2026 dropped getSequenceByID" [hetpatel] |
| Duplicate | `seq.clone()` | **renaming gotcha**: `seq.name = x` does NOT propagate to the project panel — find the ProjectItem via `item.getSequence().sequenceID === id` and set `item.name` too [hetpatel] |
| Delete | `app.project.deleteSequence(seq)` | |
| Close tab | `seq.close()` | [leancoderkavy] |
| Nest | `seq.createSubsequence(ignoreTrackTargetingBool)` | [hetpatel, leancoderkavy] |
| Settings read | `seq.getSettings()` → videoFrameWidth/Height, videoFrameRate (Time, `.ticks` = ticks-per-frame), audioSampleRate, videoFieldType, videoDisplayFormat, ... | |
| Settings write | mutate then `seq.setSettings(settings)` | [leancoderkavy, ayushozha] claim it works; [hetpatel] says "cannot be changed after creation"; **our live tests: buggy** (create-sequence non-default fps/res doesn't reliably apply). Version-dependent — don't trust it. |
| In/out | `seq.setInPoint(x)` / `setOutPoint(x)` | arg type disagreement: ticks-string [hetpatel, leancoderkavy] vs seconds-number [ayushozha] — probe both |
| Work area | `seq.setWorkAreaInPoint(ticksStr)` / `setWorkAreaOutPoint(ticksStr)`; read `seq.workInPoint.ticks`; `seq.isWorkAreaBarEnabled()` | |
| Playhead | `seq.getPlayerPosition()` → Time; `seq.setPlayerPosition(ticksString)` | all three |
| Zero point | `seq.setZeroPoint(ticksStr)`; read `seq.zeroPoint` | [leancoderkavy] |
| Auto-reframe | `seq.autoReframeSequence(num, den, motionPreset /*'slower'\|'default'\|'faster'*/, newName, nestBool)` | 2020+ only |
| Scene detect | `seq.performSceneEditDetectionOnSelection("ApplyCuts"\|"CreateMarkers", applyToLinkedAudioBool, "Low"\|"Medium"\|"High")` | [hetpatel] |
| Export direct (blocking) | `seq.exportAsMediaDirect(outPath, eprPresetPath, workAreaType)` — 0=entire, 1=in-to-out, 2=work area | |
| Export via AME | `app.encoder.launchEncoder(); app.encoder.encodeSequence(seq, outPath, presetPath, rangeConst, removeOnCompletion01); app.encoder.startBatch()` | **preset must be an absolute `.epr` file path** — a name like "H.264" silently fails (no jobID) [hetpatel]. `ENCODE_ENTIRE/ENCODE_IN_TO_OUT/ENCODE_WORKAREA`, `ENCODE_MATCH_SEQUENCE`. No progress API — fire and forget, verify output file growth. |
| Preset discovery | no API — walk `.epr` files on disk under AME/PPro app dirs; H.264 folder = `4B434D58_48323634` | [leancoderkavy]; but [ayushozha] uses `app.encoder.getExporters()` → `.getPresets()` — probe it |
| Frame export | QE `qeSeq.exportFramePNG(...)` / `exportFrameJPEG(...)` | **fundamentally unreliable**: arg order version-dependent (some builds `(path, wStr, hStr)`, others `(time, path)`), returns false/writes nothing on some builds. [leancoderkavy] brute-forces all arg combos and verifies via the filesystem, with a one-frame AME export fallback. |
| FCP XML / AAF / OMF / EDL | `seq.exportAsFinalCutProXML(path)`; `seq.exportAsAAF(path, mixdown01, mono01, rate, bits)` (also a 10-arg `app.project.exportAAF`); `app.project.exportOMF(...)`; import: prefer `app.project.importFiles([xmlPath], false, rootItem, false)` over legacy `app.openFCPXML` [hetpatel]; `app.importEDL(path)` may pop a dialog | |
| Import seqs from other project | `app.project.importSequences(prprojPath, [seqIds])` | |
| Captions | `seq.createCaptionTrack(srtProjectItem, startSeconds, Sequence.CAPTION_FORMAT_SUBTITLE)` — 3rd arg is an **integer constant, NOT a string** ("Illegal Parameter type" otherwise) [hetpatel]. Constants: `CAPTION_FORMAT_SUBTITLE/_608/_708/_TELETEXT/_OPEN_EBU/_OP42/_OP47`. [ayushozha] also: `ct.addCaption(startTicks, endTicks)` then set `.text`. **No caption READ API exists** — parse the source .srt instead. No caption-track delete either. |

## Tracks

- Collections: `seq.videoTracks/.audioTracks` → `.numTracks`, `[i]`;
  track: `.name` (writable), `.clips` (`.numItems`, `[i]`), `.transitions`,
  `.id`, `.index`.
- **Add (standard DOM)**: `seq.insertVideoTrackAt(index, count)` /
  `insertAudioTrackAt(index, count)` [leancoderkavy];
  `seq.addTrack("video")` / `seq.addTrack("audio", channelType /*0 mono,1 stereo,2 5.1,3 adaptive*/)` [ayushozha].
- **Add (QE)**: signature disputed —
  `qeSeq.addTracks(videoCount, videoInsertIndex, audioCount, audioInsertIndex, audioMediaType/*1*/, submixCount, submixInsertIndex)` (7 args) [hetpatel — with a fix comment that a 3-arg version silently inserted at the bottom shifting all indices]
  vs `qeSeq.addTracks(video, audioStereo, audioMono, audio51[, aAdaptive])` [leancoderkavy]. [hetpatel] also warns bulk addTracks **can block/wedge the CEP bridge** — prefer one at a time.
- **Remove**: `seq.videoTracks.deleteTrack(index)` [hetpatel] or
  `seq.deleteVideoTrackAt(index)` / `deleteAudioTrackAt(index)` [leancoderkavy]
  or QE `qeSeq.removeVideoTrack(i)` / `removeAudioTrack(i)` [ayushozha; also on our build's reflect list].
- Lock `track.setLocked(1|0)` (or `setLock` — [ayushozha] tries both; our
  build's QE reflect shows `setLock`); mute `track.setMute(1|0)`; solo (QE
  audio) `qeTrack.setSolo(bool)`; target `track.setTargeted(bool, true)`;
  reads `isLocked()/isMuted()/isTargeted()`.
- QE access: `qeSeq.getVideoTrackAt(i)/getAudioTrackAt(i)` → QETrack with
  `.numItems`, `.getItemAt(i)`, `.razor(...)`, `.insert(...)`,
  `.overwrite(...)` (matches our reflect dump). **QE item lists include
  Empty gap items** — filter `item.type === "Clip"` (confirmed by us and
  [hetpatel]).
- Standard-DOM↔QE index correspondence: same trackIndex/clipIndex works in
  both DOMs — [leancoderkavy]'s whole design leans on this.

## Clips / TrackItems

Standard DOM (mostly untested by us — our QE-only findings in QE_DOM_NOTES.md):

- **Insert (ripple)**: `seq.insertClip(projectItem, startTicksString, videoTrackIndex, audioTrackIndex)`.
- **Overwrite**: `seq.overwriteClip(projectItem, start, vIdx, aIdx)` —
  pass **`-1`** as the non-target index to place only the video or only
  the audio side [leancoderkavy]. Track-level:
  `track.overwriteClip(projectItem, seconds)` [hetpatel: seconds number;
  ayushozha: Time object]. (QE variant `qeTrack.overwrite(projectItem)`
  confirmed working on our build with a single arg.)
- **⚠️ Auto-linked audio trap**: overwriting a video clip whose source has
  audio silently places the linked audio too and **can destroy existing
  audio on that track** [hetpatel — "silent overlay PCM overwrote founder
  voice on A1"]. Their fix: after overwrite, scan audio tracks for clips
  with the same `projectItem.nodeId` within 0.1s and `remove(false,false)`
  them, iterating **backwards** (remove shifts indices).
- **Remove**: `clip.remove(rippleBool, alignToVideoBool)` — ripple=true
  closes the gap, false = lift. (QE `item.remove()` zero-arg also
  confirmed working on our build.)
- **Move**: assign `clip.start = newStartTicksString` (or a Time)
  [leancoderkavy, ayushozha]; or relative `clip.move(shiftSeconds)`
  [hetpatel]. **Neither standard-DOM path changes track.**
- **Move across tracks**: [leancoderkavy] calls QE
  `qeClip.moveToTrack(targetTrackIndex)` with ONE int arg — but our live
  test of exactly that got "Not Enough Parameters", and 3+ args all got
  "Illegal Parameter type". Version drift or wrong in their repo; on our
  build the working alternative is remove + `qeTrack.overwrite(projectItem)`
  (or standard-DOM overwriteClip).
- **Trim**: assign `clip.inPoint`/`clip.outPoint` (Time or ticks string);
  ripple/roll/slip/slide have **no standard-DOM API** — [ayushozha]
  hand-emulates by shifting later clips (fragile, desyncs linked audio).
  QE has native `qeClip.rippleDelete()/roll(offsetTicksStr)/slide(...)/slip(...)`
  (all on our build's reflect list too).
- **Split/razor**: QE only — `qeTrack.razor(ticksString)` [leancoderkavy,
  ayushozha] or `qeTrack.razor("HH:MM:SS:FF")` [hetpatel]. Sequence must
  be active first. Standard-DOM "fallback" (truncating `clip.end`) is
  destructive — don't.
- **Speed**: QE `qeClip.setSpeed(percent, ripple, reverse)` [ayushozha
  3-arg] / `setSpeed(percent, maintainAudioBool)` [hetpatel 2-arg] —
  another version-drift signature; read `clip.getSpeed()` (standard),
  negative/`isSpeedReversed()` = reversed. Freeze frame = Time Remapping
  "Speed" keyframes at value 0.
- **Link / unlink A+V** (the thing QE has NO method for — standard DOM does):
  - Selection-based: select clips (`clip.setSelected(1, true)`), then
    `seq.linkSelection()` / `seq.unlinkSelection()` [hetpatel, leancoderkavy].
  - Direct (claimed): `vClip.link(aClip)` / `clip.unlink()` [ayushozha —
    unverified elsewhere; probe before trusting].
  - Query: `clip.getLinkedItems()` → collection [leancoderkavy]; no
    is-linked property — repos detect links heuristically (same
    projectItem.nodeId + same start ticks across track types).
  - Menu fallback: `app.executeCommand(app.findMenuCommandId("Link"|"Unlink"))`.
- **Selection**: `clip.setSelected(1|0, /*updateUI*/1)`, `clip.isSelected()`,
  `seq.getSelection()` → TrackItem array.
- **Enable/disable**: `clip.disabled = bool` [hetpatel] or
  `clip.setDisabled(bool)` [leancoderkavy] — probe which exists.
- **Rename on timeline**: QE `qeClip.setName(x)` (standard `clip.name = x`
  also cited [hetpatel]).
- Interp/blend: `qeClip.setFrameBlend(bool)`,
  `qeClip.setTimeInterpolationType(0 sampling|1 blending|2 optical flow)`.
- IDs: `clip.nodeId` is the identity key everywhere (locating clips after
  insert, matching linked audio, dedup).
- **Source monitor 3-point editing**: `app.sourceMonitor.openProjectItem(item)
  /.getProjectItem()/.closeClip()/.closeAllClips()/.play(speed)/.getPosition()`,
  combined with seq.insertClip/overwriteClip at the playhead.
- Playback: QE `qe.startPlayback()/qe.stopPlayback()`; richer
  [ayushozha]: `qeSeq.player.play(speed)/stop()/step(±1)`.

## Effects, transitions, keyframes

**Apply = QE, tune = standard DOM.** The universal dance:

```js
app.enableQE();
var fx = qe.project.getVideoEffectByName("Gaussian Blur"); // getAudioEffectByName for audio
qeClip.addVideoEffect(fx);                                  // addAudioEffect
// back in standard DOM — new component is appended LAST:
var comp = clip.components[clip.components.numItems - 1];
```

- Enumeration: `qe.project.getVideoEffectList()/getAudioEffectList()/
  getVideoTransitionList()/getAudioTransitionList()`. **PPro 2026:
  getVideoTransitionList() returns empty — use getVideoTransitionByName**
  [leancoderkavy].
- **Component model**: `clip.components` — **[0]=Motion, [1]=Opacity,
  [2+]=applied effects** [ayushozha]; comp `.displayName`, `.matchName`
  (e.g. `AE.ADBE Motion`, `AE.ADBE Opacity`, `audioVolume`,
  `AE.ADBE Lumetri`, `AE.ADBE AECrop`, `AE.ADBE Text`), `.properties`
  (`.numItems`, `[i]`, `.getParamForDisplayName(name)` [ayushozha]),
  `.remove()` (single-effect removal [leancoderkavy] — but [hetpatel]
  claims removal impossible; probe), `.enabled`.
- **Property API**:
  ```js
  prop.getValue(); prop.setValue(value, /*updateUI*/true);   // number | bool | string | [x,y]
  prop.setColorValue(a, r, g, b, true);                       // 0-255
  prop.setTimeVarying(true);                                  // REQUIRED before keyframing
  prop.addKey(t); prop.setValueAtKey(t, v, true);
  prop.getKeys(); prop.getValueAtKey(t); prop.getValueAtTime(t);
  prop.removeKey(t); prop.removeKeyRange(t1, t2);
  prop.setInterpolationTypeAtKey(t, type[, outType][, updateUI]);  // 0=Linear, 4=Hold, 5=Bezier [leancoderkavy]; 0/1/2 map [ayushozha]
  prop.areKeyframesSupported();
  ```
  Key times: Time objects [leancoderkavy, ayushozha] or plain seconds
  [hetpatel] — version drift; keyframe times are in **sequence time**
  (add clip.start).
- **displayName matching is locale-dependent** ("Nivel", "Pegel", "音量")
  — match exact then normalized-lowercase [hetpatel].
- Motion props: Position (`[x,y]` pixels), Scale, Scale Width, Rotation
  (degrees), Anchor Point, Uniform Scale (0/1). Opacity props: Opacity
  (0-100), Blend Mode (int enum 1=Normal…22 or 27=Luminosity — the two
  repos disagree on the map size).
- **Audio Level is LINEAR AMPLITUDE, not dB**: displayed 0 dB ≈ internal
  0.17783 [hetpatel]. Their empirical calibration (PPro 2026 macOS):
  `linear = 10^((dB − 15) / 20)`. [leancoderkavy] uses `10^(dB/20)`;
  [ayushozha] mostly passes raw dB (their docs admit it's linear).
  **Calibrate against our own build before automating volume.**
- **Transitions (QE only)**: `qe.project.getVideoTransitionByName(name)`,
  then `qeClip.addTransition(tr, atEndBool, duration, ...)` — duration
  format disagrees: `"frames:00"` timecode string [hetpatel] vs seconds
  string `"1.0"` [ayushozha] vs ticks string [leancoderkavy], and arity
  varies (3–7 args). Also `qeTrack.addTransition(...)`. Probe on our
  build. Removal via standard DOM `track.transitions[i].remove(false,false)`.
  `addTransition(null, true, "1.0")` = default transition [ayushozha].
- Lumetri: apply by name if missing, then flat props by displayName
  (Exposure, Contrast, Saturation 0-200, Temperature, Tint, ..., LUT via
  `"Input LUT"` = path string). Names repeat across Lumetri sub-sections —
  first *writable* match wins; 0 is a legit value, don't falsy-check
  [leancoderkavy].
- Warp Stabilizer: apply, set "Smoothness" (num), "Method" (string enum).
- `qeClip.removeEffects()` removes ALL effects (on our reflect list too).

## Text / MOGRTs / synthetic media

- **No title-creation API exists.** Legacy `createNewTitle` is gone;
  Essential Graphics titles can't be created from script. Options:
  captions API, MOGRT import, or render a PNG externally and import it.
- MOGRT: `seq.importMGT(mogrtPath, startTicksString, vTrackIdx, aTrackIdx)`
  → trackItem; `seq.importMGTFromLibrary(libName, mogrtName, ticks, v, a)`;
  `trackItem.getMGTComponent()` → params (read AND write via setValue).
- **MOGRT Source Text format** [hetpatel — hard-won]: value =
  4-byte binary header + JSON (`mTextParam` structure). Plain
  `setValue("text")` stores but doesn't render. Correct: strip header,
  JSON-parse, patch `mTextParam.mStyleSheet.mText`, re-prepend header,
  setValue. Newer AE shape: patch `textEditValue` +
  `fontTextRunLength = [text.length]`.
- Synthetic: `app.project.newBarsAndTone(w, h, timebaseStr, name)`;
  adjustment layer — PPro 2026: `qe.project.newAdjustmentLayer()` (legacy
  `qeSeq.addAdjustmentLayer(track)` removed in 2026); QE
  `newColorMatte(r,g,b,name)`, `newTransparentVideo(name,w,h,dur)`,
  `qeTrack.insertBlackVideo(startSecsStr, durSecsStr)`,
  `qeSeq.insertBarsAndTone(wStr, hStr, durStr)`.

## Project / bins / import

- Lifecycle: `app.newProject(path)` (flaky per [leancoderkavy] research),
  `app.openDocument(path)`, `app.project.save()/saveAs(path)`,
  `project.closeDocument(save01, prompt01)`, `app.isDocumentOpen()`,
  `app.version/.build/.path`.
- **Import**: `app.project.importFiles([fsNames], /*suppressUI*/true,
  targetBin, /*asNumberedStills*/false)` — return value unreliable;
  diff `nodeId` snapshots before/after and match `getMediaPath()`
  [hetpatel]. 4th arg true = image sequence as one clip. Blocking modal
  dialogs (e.g. unsupported format) freeze the bridge — pre-filter
  extensions.
- AE: `app.project.importAEComps(aep, [names], bin)` / `importAllAEComps`;
  BridgeTalk to drive AE itself (`bt.target = "aftereffects"`).
- Bins: `parentBin.createBin(name)`, `bin.renameBin(x)`, `bin.deleteBin()`,
  `app.project.deleteAsset(item)`, `item.moveBin(destBin)`,
  `rootItem.createSmartBin(name, query)`, `app.project.getInsertionBin()`.
  Type: `item.type === ProjectItemType.BIN` (2); 1=clip, 4=file;
  `item.isSequence()`, `item.treePath`.
- Lookup: recursive `rootItem.children` walk by nodeId/name;
  `rootItem.findItemsMatchingMediaPath(pathSubstr)` → array.
- ProjectItem: `getMediaPath()`, `canChangeMediaPath()`,
  `changeMediaPath(newPath, /*overrideChecks*/true)`, `refreshMedia()`,
  `setOffline()/isOffline()`, `setScaleToFrameSize()`,
  `setOverrideFrameRate(fps)`, `setOverridePixelAspectRatio(num, den)`,
  `setStartTime(ticksStr)`, `item.name = x`,
  `setInPoint(ticks, mediaType /*1 video, 2 audio, 4 all*/)` /
  `setOutPoint` / `clearInPoint()` / `clearOutPoint()`,
  `createSubClip(name, inTicks, outTicks, hardBounds01, takeVideo01, takeAudio01)`
  (arg order of the last two flipped between repos — probe),
  `item.setAudioGain(dB)` [ayushozha], footage interpretation
  (`getFootageInterpretation()` → mutate `.frameRate/.pixelAspectRatio/
  .fieldType/.alphaUsage` → `setFootageInterpretation(i)`).
- Proxies: `hasProxy()/canProxy()/getProxyPath()/attachProxy(path, isHiRes01)/
  detachProxy()`; `item.createProxy(presetPath)` claimed by [ayushozha]
  but [leancoderkavy] says no createProxy exists (AME route only) — probe.
  Global: `app.project.setProxyEnabled(bool)` or QE `toggleProxies`.
- `app.project.consolidateDuplicates()`; Project Manager via
  `app.projectManager` attrs + `pm.process(app.project)`.

## Markers, metadata, misc

- Markers (same API on `seq.markers`, `clip.markers`, `item.getMarkers()`):
  `markers.createMarker(SECONDS)` → set `.name/.comments/.type
  ("Comment"|"Chapter"|"Segmentation"|"WebLink")/.end = seconds/
  .setColorByIndex(0-7)`; iterate `getFirstMarker()/getNextMarker(m)`
  (no indexing [ayushozha] — though [hetpatel] indexes+`deleteMarker(i)`);
  `markers.deleteMarker(m)`; id = `marker.guid`.
- Labels: `item.setColorLabel(0-15)` (0=Violet … 15=Yellow).
- Metadata: `item.getProjectMetadata()/setProjectMetadata(value, [fieldPath])`,
  `getXMPMetadata()/setXMPMetadata(xml)` (XMPMeta via AdobeXMPScript),
  `app.project.addPropertyToProjectMetadataSchema(name, label, type)`.
- Undo: `app.project.undo()/redo()` [ayushozha] or QE `qe.project.undo()`
  (redo QE-only per [leancoderkavy]). **No undo grouping** — every op is
  its own undo step.
- Workspaces: `app.getWorkspaces()/app.setWorkspace(name)`.
- Prefs: `app.properties.getProperty(key)/setProperty(key, val, persist)`
  — keys like "Default Transition Duration", "AutoSave.Enabled".
- **QE menu/command escape hatch** [ayushozha]:
  `qe.executeCommand("cmd.paste"|"cmd.undo"|"cmd.linkedSelection"|...)`,
  `qe.project.getMenuByName("File")` → walk → `item.execute()`,
  `qe.simulateKeyPress(key, ctrl, shift, alt)`. Standard-DOM equivalent:
  `app.executeCommand(app.findMenuCommandId("Undo"))` — unavailable in
  some CEP contexts.
- Events: `app.bind("onActiveSequenceChanged"|"onItemsAddedToProject"|..., fn)`;
  `app.setSDKEventMessage(msg, level)` posts to Premiere's Events panel.
- Shell: `app.system(cmd)`; `File.execute()`.

## Known-impossible (all three repos agree)

- **Synchronize/merge clips by audio waveform** — no API (matches our
  earlier conclusion).
- **Reading caption track contents** — write-only API.
- **Creating Essential Graphics titles from scratch.**
- **AME render-progress introspection** — fire and forget.
- **Undo grouping / transactional edits.**
- Native ripple/roll/slip/slide in the standard DOM (QE only).
- Multicam creation from script (flags/angles partially QE-readable).

## Transport designs compared (for our bridge's future)

| | [hetpatel] | [leancoderkavy] | [ayushozha] | ours |
|---|---|---|---|---|
| Channel | temp-dir file queue, 150/250ms polls | temp-dir file queue, 100/200ms polls | **WebSocket server (port 9801) inside CEP panel** | HTTP server (port 47823) inside CEP panel |
| Script style | inline ExtendScript strings per tool | inline strings, ES3 builder | **1,020 pre-loaded named JSX functions** + evalCommand dispatcher | pre-loaded named `ppb_` functions |

Notes for us: our HTTP-server-in-panel approach is architecturally closest
to [ayushozha] (theirs proves a socket server inside CEP scales to 1,000+
functions). Their lazy `$.evalFile` trick matters if `index.jsx` ever gets
too big to load eagerly. All repos wrap every function to return JSON
strings and treat `"EvalScript error."` as the failure sentinel — we
already do both. ES3 only: no let/const/arrow/template literals in JSX.

## Cross-checks against our live QE tests (QE_DOM_NOTES.md)

- `qeClip.moveToTrack(int)` works in [leancoderkavy]'s code but fails
  ("Not Enough Parameters") on our build — do not assume repo code runs
  on our version.
- `qeTrack.overwrite(projectItem)` single-arg: confirmed by us; repos use
  the standard-DOM `track.overwriteClip(projectItem, time)` instead, which
  also offers time positioning — likely the better primitive for us.
- `clip.remove(ripple, alignToVideo)` standard DOM 2-arg matches our
  QE zero-arg `item.remove()` finding (QE default semantics unverified).
- The **unlink/relink** we thought didn't exist: absent from QE, but
  present in the standard DOM as `seq.linkSelection()/unlinkSelection()`
  (+ selection), and possibly `clip.link()/unlink()` — this reopens the
  original "unlink → replace audio → relink" workflow as fully scriptable.

## 2026-07-17 addendum — antipaster & jordanl61 repos

Two more repos were evaluated as fix-sources for the broken commands in
BUILD_FINDINGS.md, and antipaster's leads were live-probed the same day
(results in BUILD_FINDINGS.md's corrections section, which supersedes
everything here).

### [antipaster] `antipaster/Adobe-Premiere-Pro-MCP`

Original code (not a fork of the other three). MCP → WebSocket :8097 →
CEP panel → evalScript; 12 domain `.jsx` modules preloaded via
`$.evalFile`; Windows installer; "tested on 2026". Claims vs our build:

| Claim | Our live result |
|---|---|
| `qe.project.undoStackManager.undo()/.redo()` (playback.jsx) | does NOT exist on our build — but probing around it surfaced `qe.project.undoStackIndex()`, which led to the undo/redo correction |
| `qeClip.moveToTrack(vOffset, aOffset, "0", false)` — relative offsets (timeline.jsx) | **WORKS** — true lossless move |
| `qe.project.newBarsAndTone(w, h)` 2-arg (graphics.jsx) | **WORKS** |
| DOM `clip.setSpeed(str, "ticks", rev, pitch)` 4-arg (timeline.jsx) | DOM clips have no `setSpeed` here — but the qeClip 5-arg variant they use for freeze-frames led to the working signature |
| `qe.project.newAdjustmentLayer(name, w, h)` (swallowed catch + "drag it yourself" note) | still absent (typeof undefined) |
| Track-object `seq.videoTracks[i].insertClip(item, TimeObject)` | **WORKS and honors the track index** |
| `seq.setWorkAreaInPoint/OutPoint` wrapped in "not available in this version" catches | confirms our work-area finding |
| Removing one effect via `components[i].remove()` (naive) | nothing new — still a silent no-op here |
| `clip.markers.createMarker()` (naive) | nothing new — `clip.markers` still undefined here |
| ARM64 note: **Premiere 2026 ARM64's ExtendScript lacks a native `JSON` global** (they ship a json2 polyfill) | not yet relevant on this Intel-runtime install, but remember if the panel ever misbehaves on Apple Silicon |

They avoided entirely (no code at all): roll edit, range lift/extract,
`setSettings()`, poster frames. `nestClips` is an explicit "use the
Premiere UI" punt.

### [jordanl61] `jordanl61/premiere-pro-mcp-server` — dead end

Hollow shell; do not revisit. The MCP server proxies everything to an
HTTP server (`server.cjs`) that was **gitignored and never committed**;
the Node→ExtendScript bridge is a stub that fakes success
(`runExtendScriptFile.js`); the only real ExtendScript is a 34-line trim
script with a classic Time-object-copy no-op bug. None of our 14 broken
areas is even attempted.

### hetpatel re-check (commits since our study)

`src/tools/expanded.ts` (2026-06-29) registers ~178 tools but implements
~77 — the rest hit a `default:` branch returning fake success. Its
menu-command escape hatch (`app.findMenuCommandId` + `app.executeCommand`
for Undo/Lift/Extract) is **unavailable in our CEP context** (both
`undefined`, as is `qe.executeCommand`). Its `addToTimeline`
independently converged on the same track-object `overwriteClip` pattern
antipaster uses, plus a linked-audio cleanup scan (remove the
auto-placed audio counterpart, iterating backwards) worth keeping in
mind.
