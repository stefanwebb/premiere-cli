# Desktop driver findings — macOS Accessibility API + CGEvent

Live findings from building `desktop_driver.py`, observed against Premiere
Pro 2026 (26.3.0, macOS). These are macOS Accessibility/CGEvent findings,
not Premiere ExtendScript/QE ones — see [BUILD_FINDINGS.md](BUILD_FINDINGS.md)
for those. Re-verify after any macOS or Premiere upgrade.

> **2026-07-23 — `desktop-set-input-lut` removed.** Everything below through
> "Update (2026-07-23 continued) — Lumetri Color added via the DOM, not the
> UI" documents that command's implementation, which drove Premiere's
> Lumetri "Input LUT" control via AX content-matching and keyboard-nav over
> its custom-drawn dropdown. It was removed to be rebuilt on the generic
> `desktop-*` primitives (see the module docstring) plus AI vision-language
> screen understanding, rather than hand-written AX-tree navigation specific
> to one control. The findings are kept as historical background — much of
> it (AX-tree-lags-input behavior, `AXFocusedUIElement` unreliability,
> `AXPress` not working on certain custom-drawn controls) generalizes to
> whatever replaces it. The section "Update (2026-07-23 continued) —
> generic desktop-driving primitives" further down covers the primitives
> that DO still exist.

## Why this exists

`apply-lut` can't set the Lumetri "Input LUT" via ExtendScript on this
build — `prop.setValue(lutPath)` is rejected (see
`panel/host/commands/apply-lut.jsx` for the full finding). `desktop-set-
input-lut` sets it instead by driving the real native UI.

## What works, and why

- The Input LUT combobox is locatable by CONTENT — the one AXComboBox
  whose children include a `"Browse..."` label — not by position or
  current value. Survives workspace layout changes and clips that already
  have a LUT applied.
- Its dropdown items are custom-drawn (`AXUnknown`, zero geometry, no
  actions) — can't be pressed or hit-tested. But the OPEN dropdown is
  keyboard-navigable, and AX still reports the item list and the
  combobox's current value, so the target is reachable by pressing Down
  `index(target) - index(current)` times. No coordinates, no vision step.
- The same technique reaches Effect Controls' "Add Lumetri Color Effect"
  item, letting `ensure_lumetri_color` add the effect if missing before
  setting the LUT.
- The file dialog opens as an `[AXWindow AXDialog]` on Premiere's OWN
  process (not sandboxed, so `NSOpenPanel` runs in-process) — its
  Cancel/Open buttons are AX-pressable.
- Selecting the file: Cmd-Shift-G with the FULL FILE PATH (directory +
  filename) selects the file outright. A two-phase design (directory via
  Cmd-Shift-G, then type-ahead the filename) can never work — see below.

## Bugs that made this look impossible, and their fixes

1. **`CGEventSetFlags` must be set unconditionally, including to 0.** A
   freshly created `CGEvent` inherits the current event-source modifier
   state — after a Cmd-Shift-G chord, an unflagged event posted right
   after can still arrive as Cmd-Shift-`<key>`. Every keystroke now sets
   flags explicitly, never conditionally.
2. **Type-ahead can never work for file/list selection.** Every synthetic
   character carries virtual keycode 0 and relies on the attached unicode
   string. Text fields honor that string; AppKit type-ahead (file lists,
   sidebars, outline views) reads the KEYCODE instead, so a typed filename
   was seen as a run of `'a'` and the list wandered off to whatever
   matched (observed landing on "Applications"). Fixed by selecting the
   file via Cmd-Shift-G with the full path instead of type-ahead.
3. **Typing too fast drops characters.** At ~8ms/char, Premiere's busy
   main thread silently dropped characters — a typed path arrived as
   `"/sers/..."` instead of `"/Users/..."`. A dropped character produces
   an invalid path that fails exactly like a hung dialog, with no error.
   Fixed by pacing (`type_text`) and, wherever it matters, reading the
   field back through AX and retrying until it matches (`type_verified`).
4. **Premiere's AX tree lags synthetic input by seconds — in BOTH
   directions.** A single read taken right after driving routinely reports
   an element as absent when it's plainly on screen (`wait_for` polls
   instead of trusting one sample) — and, less obviously, a single read
   can also report an element as PRESENT when it's stale, or ABSENT when
   the element is actually there, right after an unrelated prior
   operation. Live-confirmed case: right after a `set_input_lut` call
   finished (closing the file dialog), the very next call's precondition
   check occasionally reported the Input LUT combobox missing even though
   the clip still had Lumetri Color applied — risking `ensure_lumetri_color`
   clicking "Add Lumetri Color Effect" on a clip that already had one.
   Fixed by polling absence checks too (`lumetri_color_present`), not just
   presence checks.
5. **Escape cancels the whole panel if no sheet is open** — it isn't a
   safe "clear any stray state" reset. `drive_open_panel_to` only sends
   Cmd-Shift-G when a go-to-folder sheet isn't already open, and never
   sends Escape defensively.
6. **The very first `AXPress` on a combobox occasionally has no visible
   effect**, even after `ensure_frontmost` has confirmed (via the window
   server) that Premiere owns the frontmost window. A second, identical
   press worked immediately. Hypothesis: process-frontmost doesn't
   guarantee the specific panel/control has taken first-responder status
   yet, and `AXUIElementPerformAction` reports success regardless of
   whether the app actually acted on it. Fixed with `_open_and_select`,
   which retries the whole open-dropdown-and-navigate sequence (fresh
   `AXPress` included) if the expected result doesn't appear within a
   shortened per-attempt timeout — not a blind extra sleep, since there's
   no reliable constant to tune.
7. **`search()`'s original recursive implementation crashed with
   `RecursionError`** against Premiere's real AX tree in one particular UI
   state (multiple clips selected). Depth alone can exceed Python's
   default recursion limit, and a cyclic AX relationship would recurse
   forever regardless of the node-count budget. Rewritten iteratively
   (explicit stack) — no depth limit needed, and immune to cycles.
8. **Driving the LUT picker while multiple clips are selected applies the
   change to ALL selected clips at once** (live-confirmed) — the Lumetri
   panel shows "Multiple clips selected" instead of Basic Correction in
   that state. Detecting this via AX text-matching proved fragile (the
   label isn't always in the tree depending on panel/tab state); the
   reliable check is the DOM's own `getSelection()`, already exposed via
   the panel's `get-premiere-state` command. `set_input_lut` calls
   `selected_clip_names()` (a plain HTTP request to the same `/command`
   endpoint every other premiere-cli command uses) as a hard precondition
   and refuses to proceed unless exactly one clip is selected.

## Live-tested scenarios (2026-07-23, Premiere Pro 26.3.0)

- Setting a new LUT on a clip that already has Lumetri Color applied —
  repeated back-to-back with different LUTs, exercising both directions
  of the navigation delta (including the "current value not in the
  dropdown's label list" fallback, which happens because Premiere renames
  the `"[Custom]"` slot to whichever LUT is currently applied).
- Adding Lumetri Color to a clip that has none, then setting the LUT, in
  one `desktop-set-input-lut` call.
- Cold start: Premiere backgrounded (another app frontmost, including
  mid-interaction with an unsent Slack draft), then driven immediately
  after activation.
- Two clips selected: confirmed the command refuses to proceed rather
  than silently applying the LUT to both.

## Update (2026-07-23) — Lumetri Color added via the DOM, not the UI

`ensure_lumetri_color` originally only handled "Lumetri Color effect
entirely absent." Live use surfaced a second state it didn't cover: Lumetri
Color attached via the DOM-side `apply-effect` command (`premiere-cli
apply-effect --effect-name "Lumetri Color" ...`) rather than through
Effect Controls' own "Add Lumetri Color Effect" picker. That path attaches
the effect component directly with no UI interaction at all, so — unlike
adding it through the UI, which auto-expands Basic Correction — it leaves
Basic Correction collapsed. `lumetri_color_present` reports this identically
to "not present" (the Input LUT combobox genuinely doesn't exist in the AX
tree either way), but there was nothing left for `ensure_lumetri_color` to
"add," so it failed with a misleading precondition error.

9. **Effect Controls' six Lumetri Color section headers (Basic Correction,
   Creative, Curves, Color Wheels & Match, HSL Secondary, Vignette) carry
   NO accessible text label at all.** Confirmed by dumping the entire AX
   tree and finding zero elements whose text contains "basic
   correction"/"creative"/etc — they're pure canvas-drawn text, unlike
   every other effect's own properties (which always interleave a
   labelled "Toggle animation" button and a text field between rows). The
   one accessible artifact per section is a bare, unlabelled `AXButton`
   whose label IS its expand state (`"Not Selected"` collapsed, `"Selected"`
   expanded) — and Lumetri Color is the only effect with exactly six of
   these back-to-back: same x, evenly spaced by one row height (~21pt).
   `_find_lumetri_section_toggles` fingerprints this shape rather than
   any label, so it's independent of how many other effects (Motion,
   Opacity, ...) precede Lumetri Color on the clip.
10. **`AXPress` on that disclosure button reports success
    (`kAXErrorSuccess`) while leaving the AX tree byte-for-byte unchanged**
    — live-confirmed by diffing a full tree dump before/after the press:
    identical element count, identical positions for every element,
    including the pressed one. This matches the SAME symptom hit earlier
    trying to `AXPress` the dedicated "Lumetri Color" panel tab (a
    different control, same non-response). The fix, `click_element`, posts
    a REAL synthetic mouse event (move, then down/up) at the element's
    AX-reported center instead — confirmed working via a live
    collapse/expand round-trip (collapse Basic Correction with a real
    click, confirm the Input LUT combobox disappears, call
    `ensure_lumetri_color`, confirm it reappears with the previously-set
    LUT value intact).
11. **A real mouse click risks landing on whatever app is ACTUALLY
    frontmost, not whichever one a stale check confirmed** — live-hit when
    the operator's own attention (and the OS's frontmost app) moved to a
    different window in the gap between `ensure_frontmost` returning and
    the click being sent. `click_element` re-checks `frontmost_pid()`
    immediately before the mouse-move AND again immediately before the
    down/up, aborting without sending input if focus slipped either time
    — the existing on-screen overlay (`_make_overlay`) stays visible
    through the whole sequence so the operator has a standing visual cue
    not to touch input while any of this runs.
12. **Two different panels can expose an Input LUT combobox matching the
    identical content probe** — the compact row inside Effect Controls
    (every function in this module is meant to target this one) and a
    separate, dedicated "Lumetri Color" panel tab docked elsewhere. If
    that dedicated tab is ALSO frontmost, its own combobox matches
    `_combobox_containing(app_el, "Browse...")` just as well, so whichever
    tab is actually active determines which one gets found and driven.
    `set_input_lut` now calls `_activate_effect_controls_tab` (itself
    using `click_element`, since this tab-switch button is ALSO
    unresponsive to `AXPress`) before touching anything Lumetri-related,
    and nothing in this module ever clicks the dedicated Lumetri Color
    tab — every read/write here is scoped to Effect Controls specifically.

### Live-tested (2026-07-23 continued)

- Full collapse → recover round-trip: Basic Correction expanded, collapsed
  again via a real click, then `ensure_lumetri_color` re-expanded it and
  the Input LUT combobox reappeared with its previously-set value
  (`corrected_00-00-14`) intact.
- `ensure_lumetri_color`'s fast path (Lumetri Color already present and
  expanded) confirmed still returns `True` immediately without attempting
  any click.
- `_activate_effect_controls_tab` confirmed callable mid-session without
  disrupting the already-expanded Basic Correction state.

## Update (2026-07-23 continued) — generic desktop-driving primitives

Added six raw primitives (`desktop-take-screenshot`, `desktop-press-key`,
`desktop-enter-text`, `desktop-enter-text-with-validate`,
`desktop-move-mouse`, `desktop-click-mouse`) plus a persistent notification
window (`desktop-notify` / `desktop-dismiss-notifications`), for driving
Premiere beyond the Lumetri-specific commands above. All six DRIVE
commands share `_require_frontmost` (same confirm-before-input discipline
as `set_input_lut`).

13. **Premiere's app-wide `AXFocusedUIElement` does not reliably track its
    own custom-drawn panels.** Clicked directly into the Project panel's
    search field (using its exact AX-reported frame, not a coordinate
    guess) and immediately read `AXFocusedUIElement` — it reported an
    unrelated, stale `"Select Zoom Level"` combobox (value `"Fit"`) both
    times, across two separate attempts. The text itself DID land
    correctly (confirmed separately: `desktop-enter-text` followed by
    `desktop-take-screenshot` showed the search field reading `"test123"`
    and the bin filtered to 1 item) — only the FOCUS READ-BACK is
    unreliable, not the actual keystroke delivery. This means
    `desktop-enter-text-with-validate` will most likely false-fail (exit
    4) against Premiere's own panels; it's documented as reliable only
    against genuinely native AX-compliant fields (e.g. the "Select a LUT"
    dialog's own field, addressed directly by `drive_open_panel_to` rather
    than via focus lookup). For typing into Premiere's own UI, prefer
    plain `desktop-enter-text` and verify visually with
    `desktop-take-screenshot` instead.
14. **A persistent notification window needs a SEPARATE daemon process,
    not another `desktop_overlay.Overlay`** — `Overlay` (used by every
    DRIVE command's status banner) only lives as long as that one
    command's own process, which exits (and closes the window) as soon as
    the command finishes. `desktop-notify` needs the opposite: a window
    that OUTLIVES the CLI invocation that created it, so a LATER
    `desktop-notify` call (a different process) can update the SAME
    window rather than opening a new one, and `desktop-dismiss-
    notifications` can close it. `notify_daemon.py` solves this as a
    small standalone process (spawned detached via `start_new_session` on
    first use) running its own Cocoa run loop on the main thread and a
    tiny local HTTP server on a background thread — the HTTP handler only
    ever sets flags under a lock; every actual AppKit call happens on the
    main thread's own polling loop, avoiding any cross-thread Cocoa calls.
    Live-tested: a second `desktop-notify` call updated the same window's
    text/color in place (confirmed via screenshot — one window, not two,
    and exactly one `notify_daemon` process via `pgrep`);
    `desktop-dismiss-notifications` closed it and the process exited
    (confirmed gone via both a screenshot and `pgrep`); calling dismiss
    again with nothing running returned `{"ok": true, "wasRunning":
    false}` rather than erroring.
15. **Coordinate math done by hand (screenshot pixels → AX points) is
    error-prone even with the actual retina scale factor accounted for**
    — a hand-computed click target for the Project panel's search field
    landed on the "Select Zoom Level" combobox instead, one panel row off.
    Getting the field's exact frame via AX (`search()` + `_element_frame`)
    and clicking its computed center worked first try. Prefer AX-derived
    coordinates over manual screenshot measurement whenever the target
    element can be addressed by role/label.
