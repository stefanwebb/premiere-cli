## New features

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
  screen understanding.)
