# Changelog

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
