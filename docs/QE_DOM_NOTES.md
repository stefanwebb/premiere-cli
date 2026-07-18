# QE DOM findings (clip-level editing)

Notes from live-testing the undocumented QE (Quality Engineering) DOM via
the temporary `debug-qe-inspect` command (`host/index.jsx`), toward
automating "unlink audio/video, delete audio, move in different audio,
re-link" via the CEP/CLI bridge. Premiere Pro version tested: whatever was
open 2026-07 (not pinned to a specific build — QE DOM varies by version,
re-verify before relying on this after an Premiere update).

## How to reproduce

    premiere-cli debug-qe-inspect

Requires a project + active sequence open in Premiere, and the panel
reopened after any `host/index.jsx` edit (ExtendScript engine caches the
loaded script).

## Key finding: no unlink/link method exists

Checked via ExtendScript's built-in `.reflect` introspection (authoritative
— lists the object's real method/property names) on:

- the active sequence (`qe.project.getActiveSequence()`)
- a video/audio `Track` (`qeSeq.getVideoTrackAt(i)` / `getAudioTrackAt(i)`)
- a `Clip` TrackItem (`track.getItemAt(i)`)

None of these expose anything named `link`, `unlink`, `isLinked`, or
similar. This isn't a discovery gap — reflection lists every method the
host actually implements, and there's nothing link-related on any of the
three object types.

**UPDATE (2026-07):** link/unlink DOES exist — in the *standard* DOM, not
QE: `sequence.linkSelection()` / `sequence.unlinkSelection()` (after
selecting clips via `clip.setSelected(1, true)`), plus possibly
`clip.link(other)` / `clip.unlink()`. Found by studying three open-source
Premiere MCP servers — see [PREMIERE_API_NOTES.md](PREMIERE_API_NOTES.md)
for the full extracted API reference (untested on our build).

## Why that's probably fine anyway

A synced video+audio clip is represented as two *independent* `TrackItem`
objects — one on a video track, one on an audio track — that happen to
share the same source clip. Confirmed live: a clip named
`main camera.MP4` showed up as a separate `Clip` item on `Video 1` and
again on `Audio 1` (and `Audio 2` — this camera has two audio tracks).

Since the QE DOM lets you call `.remove()` / `.move()` / `.moveToTrack()`
directly on the *audio* TrackItem without ever touching the video
TrackItem, the "unlink → delete audio → move in different audio → relink"
workflow (which is only a UI necessity — Premiere's UI won't let you
delete/move synced audio without either an explicit unlink or a warning
dialog) likely collapses to just: remove the old audio TrackItem, then
move/place the replacement audio TrackItem into that track position. No
explicit unlink or relink step needed, because the QE DOM was never
tracking a link in the first place.

Unconfirmed: whether Premiere's UI still displays a "linked" badge/behavor
on the video clip and the newly-placed audio afterward, and whether that
matters for downstream editing. Verify visually in Premiere after a real
test call.

## Object API surface (`.reflect.methods`, this build)

### Sequence (`qe.project.getActiveSequence()`)

Relevant subset (full list also includes standard JS Object methods like
`hasOwnProperty`, `toSource`, `watch`, omitted here):

    addTracks, removeTracks, removeAudioTrack, removeVideoTrack,
    removeEmptyAudioTracks, removeEmptyVideoTracks, getAudioTrackAt,
    getVideoTrackAt, razor, extract, lockTracks, muteTracks, syncLockTracks,
    setCTI, setInPoint, setOutPoint, setInOutPoints, renderAll, renderAudio,
    renderPreview, exportDirect, exportToAME, ...

No link/unlink/sync method among these either.

### Track (`getVideoTrackAt(i)` / `getAudioTrackAt(i)`)

    addAudioEffect, getComponentAt, getItemAt, getTransitionAt, insert,
    isLocked, isMuted, isSyncLocked, overwrite, razor, setLock, setMute,
    setName, setSyncLock

`track.numItems` includes "Empty" gap-placeholder items alongside real
"Clip" items — **don't assume `getItemAt(0)` is a real clip**; scan and
check `item.type !== "Empty"`.

### Clip (a populated `TrackItem`, `track.getItemAt(i)` where `type === "Clip"`)

    addAudioEffect, addTransition, addVideoEffect, canDoMulticam,
    getClipPanComponent, getComponentAt, getProjectItem, move, moveToTrack,
    remove, removeEffects, rippleDelete, roll, setAntiAliasQuality,
    setBorderColor, setBorderWidth, setEndPercent, setEndPosition,
    setFrameBlend, setMulticam, setName, setReverse, setScaleToFrameSize,
    setSpeed, setStartPercent, setStartPosition, setSwitchSources,
    setTimeInterpolationType, slide, slip

The methods relevant to the target workflow: **`remove`**, **`move`**,
**`moveToTrack`**, **`rippleDelete`**.

Properties (via `for...in`, not exhaustive as methods aren't enumerable
this way): `name`, `type` (`"Clip"` | `"Empty"`), `start`/`end` (QETime
objects, not plain numbers — need their own accessor methods, unconfirmed
which), `duration` (string, e.g. `"00:36:15:21"`), `mediaType`
(`"Video"`/`"Audio"`), `numComponents`, `speed`, `reverse`, etc.

## Reflection has no method metadata on this build

Extended `debug-qe-inspect` to also pull `.reflect.methods[i].description`
and `.parameters` (`reflectMethodDetails`). Ran it live: every method on
Sequence, Track, and Clip came back with `description: null` and
`parameters: []`, including `remove`, `move`, and `moveToTrack`. This QE
DOM build only exposes method *names* via reflection, not signatures —
that avenue is exhausted; don't re-try it expecting a different result on
the same Premiere version.

## Live mutation tests (`debug-qe-try-mutate`, on a duplicate sequence)

Added a safety-guarded command (`ppb_debugQeTryMutate`, requires
`args.sequenceName` to exactly match the *active* sequence — refuses to
run otherwise) to actually call these methods on a throwaway duplicate
sequence and observe the result, since reflection gave names but no
signatures.

### `clip.remove()` — CONFIRMED WORKING, zero arguments

    item.remove()

Called with no arguments on the `Clip` TrackItem for `main camera.MP4` —
succeeded first try. Track went from `[Empty, Clip, Empty]` to a single
merged `[Empty]` item. (Didn't confirm ripple-vs-lift semantics — the
track had only one clip, so nothing downstream to shift/not-shift. Verify
this on a track with multiple clips before relying on "lift" behavior.)

### `clip.moveToTrack(...)` — UNRESOLVED, deprioritized

Extensive guessing failed. Evidence gathered:

- Passing the `Track` object itself as arg 0 → `Illegal Parameter type`
  (wrong type), regardless of how many total args.
- Passing a plain track-index number as the sole/first arg with only 1-2
  total args → `Not Enough Parameters` (right type, just too few args).
- Passing 3+ args (numbers, booleans, a constructed `new Time()`, and the
  clip's own `.start` QETime instance, in various slot combinations) → all
  came back `Illegal Parameter type` again, with no variant format tried
  producing a new error message. Cannot pin down the correct signature
  from these clues alone.

**Recommendation: don't keep guessing `moveToTrack`.** A confirmed
alternative exists (below) that achieves the practical goal without it.

### `track.insert(projectItem)` — takes MORE than 1 arg

    destTrack.insert(projectItem)   // → "Not Enough Parameters"

So `insert` needs at least a position argument too; untested what
satisfies it (the `Time`-object guesses that failed for `moveToTrack` were
not retried against `insert` with 2 args — worth trying next: `Time`
object as arg 1, and numeric ticks/frames as arg 1).

### `track.overwrite(projectItem)` — CONFIRMED WORKING, single argument

    destTrack.overwrite(projectItem)

Where `projectItem` came from `clip.getProjectItem()` on an *existing*
timeline `Clip` (not a bin-panel `ProjectItem` fetched another way — but
presumably any `app.project` `ProjectItem` reference works the same, since
this is the same media-source concept as the standard DOM). Succeeded with
**no explicit time argument** — landed the new clip at the very start of
the destination track (`index 0`, replacing that track's `Empty` span).
Where exactly `overwrite(projectItem)` places it when the CTI is
positioned elsewhere, or on a track that already has content, is
untested — but for "place clip at time 0 on an empty track" this is a
confirmed one-liner.

`getProjectItem()` returns a rich, JSON-friendly object, e.g.:

    {
      "clip": {
        "audioChannelType": 1, "audioFrameRate": 48000, "audioNumChannels": 1,
        "audioSampleSize": 6, "duration": "00:36:05:05280",
        "filePath": "/Volumes/.../main mic.wav", "name": "main mic.wav",
        "videoFieldType": 0, "videoFrameHeight": 0, "videoFrameRate": 0,
        "videoFrameWidth": 0, "videoHasAlpha": false, "videoPixelAspectRatio": ""
      },
      "filePath": "/Volumes/.../main mic.wav",
      "name": "main mic.wav"
    }

`filePath` is present at both the top level and nested under `.clip` —
useful for matching/selecting a specific source clip by file path.

## Practical path for the target workflow (unlink/delete/move/relink)

Given the above, the "unlink video/audio, delete audio, move in different
audio, re-link" workflow likely reduces to, with NO unlink/relink step and
NO `moveToTrack` needed:

1. Get the replacement audio's `ProjectItem` via
   `sourceClip.getProjectItem()` (where `sourceClip` is either an existing
   timeline `Clip` on some other track, or a bin item looked up another
   way — only the former is confirmed).
2. `targetTrackItem.remove()` — delete the old audio clip on the
   destination track (confirmed working, no args).
3. `destTrack.overwrite(projectItem)` — place the replacement (confirmed
   working, no args beyond the project item, for placement at track
   start).

Still unconfirmed / next steps:

- Position control: how to `overwrite`/`insert` at a specific time other
  than track start (needed for real use — you generally want the
  replacement audio at the *same* position the old clip occupied, not at
  time 0). Try `Time` objects and numeric ticks as the second argument to
  both `insert` and `overwrite`.
- Whether Premiere's UI shows the video clip and the newly-placed audio as
  "linked" or not afterward, and whether that matters for further editing
  — verify visually in Premiere after a real test call.
- Ripple-vs-lift semantics of `remove()` on a track with multiple
  surrounding clips (untested — the one test track had only one clip).
- Whether the intended workflow needs the *audio component of a video
  clip* (an AV clip's embedded audio channel) versus a *separate audio
  TrackItem* already on its own audio track — the tested project's clips
  were the latter, so component-level audio extraction from a single AV
  TrackItem (`getComponentAt`?) is untested.
- `insert()`'s exact signature (position argument type) — untested.

## Live-tested: `razor()` + `rippleDelete()`/`remove()` for batch pause removal (2026-07-13)

Built as `remove-track-intervals` (`ppb_removeTrackIntervals` in
`host/index.jsx`), first live run against a real 405s/25fps sequence with
74 cut intervals across audio track 1 + linked video track 1.

**Confirmed working end-to-end**: `qeSequence.razor(timecode)` (cuts every
track at that point) + per-track `findAndRemoveInRange` (find items in a
time range, remove via `rippleDelete()` then a `remove(bool,bool)`
fallback, judged by an actual `numItems` drop) correctly ripple-deleted
all 74 intervals on both the audio and linked video track, keeping them
in sync — confirmed visually in Premiere afterward.

**Gotcha caught on the very first live run**: `findAndRemoveInRange`
initially scanned every item in the tolerance window regardless of
`type`, so it picked up `"Empty"` gap-placeholder items (not just real
`"Clip"` items) as removal targets — same gotcha already noted above
("don't assume `getItemAt(0)` is a real clip"), just missed when adapting
the reference implementation for this command. Attempting to remove an
Empty item is a harmless no-op (nothing there to remove), but it produced
a misleading warning ("N of M segments could not be removed") on
*every single interval* even though the real edit succeeded correctly
every time. Fixed by skipping non-`"Clip"` items before adding them to
the removal candidate list. Lesson: **any QE track scan must filter
`item.type === "Clip"`, every time, with no exceptions** — this is the
second command in this bridge to have hit exactly this gotcha.
