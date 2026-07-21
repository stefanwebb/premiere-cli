# Changelog

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
