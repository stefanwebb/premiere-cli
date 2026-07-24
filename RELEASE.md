## Bug fixes

- **`desktop-take-screenshot` captured its own status overlay** — the overlay is a real always-on-top window pinned top-right of the screen, and `screencapture -x` captures the whole screen including it, so its "driving" banner ended up baked into the corner of every screenshot. `take_screenshot` now hides the overlay immediately before capturing (instead of showing "driving") and only re-shows it afterward, once the frame is already safely written.
