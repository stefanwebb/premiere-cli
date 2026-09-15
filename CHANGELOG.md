# Changelog

## 0.4.3 — 2026-09-15

### New features

- **`add-transition` / `batch-add-transitions` accept audio tracks** —
  `trackType: "audio"` was rejected on the assumption that no audio
  transition API existed; the QE DOM has `addTransition` on audio clips
  (resolved via `getAudioTransitionByName`), so a crossfade can now go on
  every cut of an audio track. `list-available-transitions` /
  `list-available-audio-transitions` also now return the real lists (110
  video, 3 audio) instead of zero — the QE lists are plain string arrays.
- **`add-background` command** — fills given time spans of a video track
  with a looped background clip, trimming the final repeat so each span is
  covered exactly. Repeats are quantised to whole frames on *both* the
  sequence's and the source's frame grid, so mixed 25/30/50 fps material
  tiles gap-free. `--dry-run` reports the plan; the source item's in/out is
  restored afterwards. Loud warning: a background with an audio stream
  destroys the audio underneath it — strip the audio from the file first.
- **`sync-assets` command** — imports every media file under an `assets/`
  tree into bins mirroring its subdirectories. Existing items with the same
  name are relinked rather than re-imported; hidden files and AppleDouble
  `._*` sidecars are skipped.
- **`insert-clips` command** — places every clip in a bin whose name begins
  `MM-SS-FF` onto a given track at that timecode; items without a leading
  timecode are reported, not guessed, and an out-of-range frame field is
  rejected.
- **`delete-all-markers` command** — clears every marker on a sequence or
  project item in one round trip, instead of one `delete-marker` call per
  guid.

### Bug fixes

- **Transition durations were mis-sized.** The QE `addTransition` duration
  argument is `SS.FF` (seconds.frames), not decimal seconds, so `0.08` gave
  an 8-frame transition at 25 fps. Durations now go through the
  seconds.frames form, video and audio alike.

### Documentation

- **`remove-track-intervals` silently desyncs linked A/V clips** — on
  linked pairs it slips audio source in-points while leaving timeline
  positions, duration and coverage correct, so no health metric sees it.
  Unlink → apply → relink, verify every pair's
  `audio.inPointSeconds − video.inPointSeconds` against the sync offset,
  and repair a slipped clip in place with `trim-clip --in-point-seconds`.
- **There is no API way to place video without its audio** — the `-1`
  track index does not do it on Premiere 2026; the source's audio lands on
  A1 regardless of targeting and overwrites what was there.

## 0.4.2 — 2026-07-23

### Bug fixes

- **`desktop-take-screenshot` captured its own status overlay** — the overlay is a real always-on-top window pinned top-right of the screen, and `screencapture -x` captures the whole screen including it, so its "driving" banner ended up baked into the corner of every screenshot. `take_screenshot` now hides the overlay immediately before capturing (instead of showing "driving") and only re-shows it afterward, once the frame is already safely written.

## 0.4.1 — 2026-07-23

### Bug fixes

- **`desktop-*` commands could capture/act mid window-swap** — `desktop-take-screenshot` (and the other `desktop-*` primitives) confirmed Premiere was frontmost via the window server and immediately proceeded, but the actual window-swap animation/redraw can still be in flight at that instant — a screenshot taken right then could show a sliver of the previously-frontmost app. `_require_frontmost` now waits 0.5s after confirming activation before proceeding, but only when Premiere actually needed to be brought to front — skipped when it was already frontmost, so repeated calls while Premiere stays active aren't slowed down.

## 0.4.0 — 2026-07-23

### New features

- **Generic `desktop-*` UI-automation commands** (macOS only, optional
  `macos-desktop` extra): `desktop-take-screenshot`, `desktop-press-key`,
  `desktop-enter-text`, `desktop-enter-text-with-validate`,
  `desktop-move-mouse`, `desktop-click-mouse` — raw primitives (screenshot,
  key press, text entry, mouse move/click) for driving Premiere's native UI
  via the Accessibility API + synthetic key/mouse events, for actions
  ExtendScript can't do on this build. Each confirms Premiere is frontmost
  before sending input. Also **`desktop-notify` / `desktop-dismiss-
  notifications`** — a persistent, always-on-top notification window via a
  separate daemon process, so it can be updated in place or dismissed by
  later, separate CLI invocations. See
  [docs/DESKTOP_DRIVER_NOTES.md](docs/DESKTOP_DRIVER_NOTES.md).

  (An earlier `desktop-set-input-lut` command, built the same day on
  hand-written AX-tree navigation specific to Premiere's Lumetri "Input
  LUT" control, was removed before release in favor of rebuilding that
  capability on top of these generic primitives plus AI vision-language
  screen understanding. Its findings remain in
  [docs/DESKTOP_DRIVER_NOTES.md](docs/DESKTOP_DRIVER_NOTES.md) as
  background for that future work.)

## 0.3.1 — 2026-07-20

### Bug fixes

- **`export-frame` was silently exporting the wrong frame** — `qe.project.getActiveSequence().exportFramePNG` ignores its position argument on this Premiere build regardless of arg-order (ticks string, `Time` object, output-path-as-position, ...), always exporting whatever frame happened to be currently rendered in the Program Monitor, while still writing a real file and returning success. The command now exports exclusively via Adobe Media Encoder's `exportAsMediaDirect()`, narrowing the sequence's in/out points to a single frame around the requested timecode — verified live via pixel diff that exports at different timecodes actually differ and match the requested position.

## 0.3.0 — 2026-07-20

### New features

- **`init-project` command** — creates a fresh empty Premiere Pro project from a bundled template

### Improvements

- Renamed the CEP extension ID to `com.stefanwebb.premierecli`

### Infrastructure / Documentation

- Moved the Claude Code plugin into the separate `premiere-ai-skills` repo

## 0.2.0 — 2026-07-18

Initial PyPI release, renamed from `premiere-bridge` to `premiere-cli`.

## 0.1.0 — 2026-07-17

Initial release: `premiere-bridge` extracted from `video-production`.
