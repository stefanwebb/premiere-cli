# premiere-cli

Drive Adobe Premiere Pro from the command line.

`premiere-cli` pairs a zero-dependency Python CLI (`premiere-cli`,
`premiere-log`) with a bundled CEP panel ("Premiere Bridge") that runs a
local HTTP server (port 47823) inside Premiere Pro and exposes its
ExtendScript / QE scripting APIs as ~230 JSON-in/JSON-out commands —
reading project/sequence/clip state, editing the timeline, applying
effects, managing markers and bins, exporting media and frames, and more.

The Claude Code skill for driving this CLI lives in the separate
[premiere-ai-skills](https://github.com/stefanwebb/premiere-ai-skills)
plugin, alongside the AI-assisted workflow skills — install that plugin
to give Claude the skill.

## Install

```bash
# 1. The CLI (isolated, no dependencies)
pipx install premiere-cli
#    or: uv tool install premiere-cli

# 2. The CEP panel (copies it into Adobe's extensions dir + enables PlayerDebugMode)
premiere-cli install-panel

# 3. Restart Premiere Pro, open  Window > Extensions > Premiere Bridge

# 4. Verify the whole chain
premiere-cli doctor
```

`premiere-cli init-project <name> --base-dir <path>` scaffolds a fresh,
empty `.prproj` from a bundled template — no Premiere Pro session needed,
so it works before step 3.

Supported: macOS and Windows (CEP does not exist on Linux). The panel
targets Premiere Pro 2020+ (CEP 10-12); the API behavior notes in
[docs/BUILD_FINDINGS.md](docs/BUILD_FINDINGS.md) were live-calibrated on
**Premiere Pro 26.3.0 (macOS)** — Premiere's undocumented QE APIs vary by
build, so re-verify build-sensitive commands on other versions.

## Use from the command line

```bash
premiere-cli get-premiere-state
premiere-cli get-active-sequence
premiere-cli add-marker --seconds 12.5 --name "Chapter 1"
premiere-cli export-frame --output /tmp/frame.png --timecode 00:12:05
premiere-log "rendering pass 2/3 started"   # shows up in the panel's log view
```

Every command prints a JSON object: `{"ok": true, "result": ...}` or
`{"ok": false, "error": "..."}` (exit code 1). Full command reference:
[docs/COMMANDS.md](docs/COMMANDS.md).

## Use from Claude Code

```
/plugin marketplace add stefanwebb/premiere-ai-skills
/plugin install premiere-ai-skills@premiere-ai-skills
```

This gives Claude the `premiere-cli` skill — a complete, behavior-annotated
catalog of the panel's commands (including which ones are verified working,
build-sensitive, or destructive). You still need steps 1-4 above so the
`premiere-cli` binary and panel exist on the machine.

## How it works

```
premiere-cli ──HTTP──> CEP panel (Node server, port 47823)
                            │ csInterface.evalScript
                            ▼
                       ppb_dispatch() ──$.evalFile──> host/commands/<name>.jsx
                            │
                            ▼
                Premiere DOM (app.project...) + QE DOM (qe.project...)
```

- Each command is one ExtendScript file under
  `src/premiere_cli/panel/host/commands/`, lazily loaded on first use.
- Mutating commands verify their own effect with read-backs (clip counts,
  property values, undo-stack index) — never by trusting an API's return
  value, since several Premiere APIs "succeed" without doing anything.
- `docs/` carries the hard-won API findings: which Premiere scripting APIs
  are broken, which lie, and the calibrated signatures that actually work
  ([BUILD_FINDINGS.md](docs/BUILD_FINDINGS.md),
  [PREMIERE_API_NOTES.md](docs/PREMIERE_API_NOTES.md),
  [QE_DOM_NOTES.md](docs/QE_DOM_NOTES.md)).

## Scope

This package deliberately contains **only** the machinery to drive
Premiere Pro's APIs. AI-assisted workflows built on top of it
(transcription with word-level timestamps, silence removal, etc.) live
separately and depend on this package.

## Development

```bash
git clone https://github.com/stefanwebb/premiere-cli
cd premiere-cli
pip install -e ".[dev]"
premiere-cli install-panel --symlink   # panel edits apply on next panel reload
pytest
```

Adding a panel command means three edits: the new
`host/commands/<name>.jsx`, its registration in `host/index.jsx`
(`PPB_COMMANDS`), and the allowlist in `js/main.js` (`ALLOWED_COMMANDS`) —
plus a CLI subparser in `src/premiere_cli/cli.py` and a row in
`docs/COMMANDS.md`. Bump the version in `pyproject.toml`,
`premiere_cli/__init__.py`, and `PANEL_VERSION` in `js/main.js`
together (`premiere-cli doctor` flags mismatches).

## License

[CC-BY-SA-4.0](LICENSE).
