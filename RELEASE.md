## New features

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

## Bug fixes

- **Transition durations were mis-sized.** The QE `addTransition` duration
  argument is `SS.FF` (seconds.frames), not decimal seconds, so `0.08` gave
  an 8-frame transition at 25 fps. Durations now go through the
  seconds.frames form, video and audio alike.

## Documentation

- **`remove-track-intervals` silently desyncs linked A/V clips** — on
  linked pairs it slips audio source in-points while leaving timeline
  positions, duration and coverage correct, so no health metric sees it.
  Unlink → apply → relink, verify every pair's
  `audio.inPointSeconds − video.inPointSeconds` against the sync offset,
  and repair a slipped clip in place with `trim-clip --in-point-seconds`.
- **There is no API way to place video without its audio** — the `-1`
  track index does not do it on Premiere 2026; the source's audio lands on
  A1 regardless of targeting and overwrites what was there.
