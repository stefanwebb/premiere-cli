"""macOS desktop driver (pyobjc) — generic UI-automation primitives for
Premiere Pro, driven through the Accessibility API + synthetic key/mouse
events, for actions Premiere's ExtendScript/QE APIs don't expose.

macOS only — imports Cocoa/ApplicationServices/Quartz unconditionally, so
this module must only ever be imported lazily (see `cli.py`'s dispatch for
every `desktop-*` subcommand), never at package-import time, so the rest of
the CLI stays usable without the `macos-desktop` extra installed.

DRIVE operations post real mouse/key events, which macOS routes to whatever
app is FRONTMOST — so Premiere must stay active and the user must keep hands
off the keyboard/mouse while they run, or the events land in the wrong app.
Every `desktop-*` command confirms Premiere is frontmost first
(`_require_frontmost`) and shows an on-screen overlay while driving
(`_make_overlay`) so this is visible to whoever's at the keyboard.

What this module provides:
  - `desktop-take-screenshot` — save a full-screen PNG.
  - `desktop-press-key` — one synthetic key press, by name or virtual
    keycode, with optional modifiers.
  - `desktop-enter-text` / `desktop-enter-text-with-validate` — literal
    unicode text entry, the latter reading the focused field's value back
    to verify (see its own docstring for a load-bearing caveat: Premiere's
    own custom panels don't reliably report focus via AX, so validation is
    only trustworthy against genuinely native fields).
  - `desktop-move-mouse` / `desktop-click-mouse` — real CGEvent mouse
    moves/clicks at given coordinates, or the current cursor position.
  - `desktop-notify` / `desktop-dismiss-notifications` — a persistent,
    always-on-top notification window via a separate daemon process (see
    `notify_daemon.py`), since it must outlive the CLI call that created it.

Historically this module also drove Premiere's Lumetri "Input LUT" control
directly (`desktop-set-input-lut`) via AX content-matching and keyboard-nav
over its custom-drawn dropdown. That command was removed 2026-07-23 to be
rebuilt on top of the generic primitives above plus AI vision-language
screen understanding, rather than hand-written AX-tree navigation specific
to one control. See `docs/DESKTOP_DRIVER_NOTES.md` for the full, dated
history of that implementation's findings — still useful background (e.g.
Premiere's AX-tree-lags-input behavior, `AXFocusedUIElement` unreliability)
for whatever replaces it.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

from AppKit import NSApplicationActivateIgnoringOtherApps, NSWorkspace
from ApplicationServices import (
    AXUIElementCreateApplication,
    AXUIElementCopyAttributeValue,
    AXUIElementSetAttributeValue,
)
from Quartz import (
    CGEventCreate,
    CGEventCreateKeyboardEvent,
    CGEventCreateMouseEvent,
    CGEventGetLocation,
    CGEventKeyboardSetUnicodeString,
    CGEventPost,
    CGEventSetFlags,
    CGWindowListCopyWindowInfo,
    kCGHIDEventTap,
    kCGEventFlagMaskAlternate,
    kCGEventFlagMaskCommand,
    kCGEventFlagMaskControl,
    kCGEventFlagMaskShift,
    kCGEventLeftMouseDown,
    kCGEventLeftMouseUp,
    kCGEventMouseMoved,
    kCGEventRightMouseDown,
    kCGEventRightMouseUp,
    kCGMouseButtonLeft,
    kCGMouseButtonRight,
    kCGNullWindowID,
    kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly,
)

PREMIERE_BUNDLE_ID = "com.adobe.PremierePro.26"
DEFAULT_PANEL_PORT = 47823

# AX attribute names as string literals (stable across pyobjc versions).
AX_VALUE = "AXValue"
AX_FOCUSED_UI_ELEMENT = "AXFocusedUIElement"

# Virtual keycode for the Cmd-A chord `type_verified` uses to select-all
# before each retry.
KEY_A = 0

# Virtual keycodes (US ANSI layout, Carbon HIToolbox numbering) for
# `desktop-press-key`'s --key name lookup. Layout-dependent — assumes the US
# keyboard layout CGEventCreateKeyboardEvent's keycode interpretation expects.
KEY_NAMES = {
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "equal": 24, "9": 25,
    "7": 26, "minus": 27, "8": 28, "0": 29, "rightbracket": 30, "o": 31, "u": 32,
    "leftbracket": 33, "i": 34, "p": 35, "return": 36, "enter": 36, "l": 37,
    "j": 38, "quote": 39, "k": 40, "semicolon": 41, "backslash": 42, "comma": 43,
    "slash": 44, "n": 45, "m": 46, "period": 47, "tab": 48, "space": 49,
    "grave": 50, "delete": 51, "backspace": 51, "escape": 53, "command": 55,
    "shift": 56, "capslock": 57, "option": 58, "control": 59, "rightshift": 60,
    "rightoption": 61, "rightcontrol": 62,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98,
    "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    "home": 115, "pageup": 116, "forwarddelete": 117, "end": 119, "pagedown": 121,
    "left": 123, "leftarrow": 123, "right": 124, "rightarrow": 124,
    "down": 125, "downarrow": 125, "up": 126, "uparrow": 126,
}

# `desktop-press-key`'s --modifier name lookup, combined into one CGEvent
# flag mask.
MODIFIER_FLAGS = {
    "command": kCGEventFlagMaskCommand,
    "cmd": kCGEventFlagMaskCommand,
    "shift": kCGEventFlagMaskShift,
    "option": kCGEventFlagMaskAlternate,
    "alt": kCGEventFlagMaskAlternate,
    "control": kCGEventFlagMaskControl,
    "ctrl": kCGEventFlagMaskControl,
}


# ----------------------------------------------------------------------------
# Accessibility reads
# ----------------------------------------------------------------------------
def ax_get(element, attr):
    """Copy one AX attribute; return None on any error (0 == kAXErrorSuccess)."""
    err, val = AXUIElementCopyAttributeValue(element, attr, None)
    return val if err == 0 else None


def find_premiere():
    """Return the running Premiere Pro app, or None."""
    ws = NSWorkspace.sharedWorkspace()
    for app in ws.runningApplications():
        if (app.bundleIdentifier() or "") == PREMIERE_BUNDLE_ID:
            return app
    # fall back to name match if the bundle-id constant is wrong for this build
    for app in ws.runningApplications():
        if "premiere" in (app.localizedName() or "").lower():
            return app
    return None


def app_ax_element(app):
    return AXUIElementCreateApplication(app.processIdentifier())


# ----------------------------------------------------------------------------
# Synthetic key events (CGEvent)
# ----------------------------------------------------------------------------
def press_key(keycode, flags=0, pause=0.05):
    """Post a key-down/up for a virtual keycode, with optional modifier flags.

    Flags are set unconditionally, including to 0: a freshly created CGEvent
    inherits the current event-source modifier state, so after a chord like
    Cmd-Shift-G an unflagged event can still arrive as Cmd-Shift-<key>.
    """
    for down in (True, False):
        ev = CGEventCreateKeyboardEvent(None, keycode, down)
        CGEventSetFlags(ev, flags)
        CGEventPost(kCGHIDEventTap, ev)
        time.sleep(0.012)
    time.sleep(pause)


def type_text(text, per_char=0.03):
    """Type a unicode string without keycode mapping (path-safe).

    Pacing is deliberate. At the original ~8ms/char Premiere's busy main
    thread silently DROPPED characters — a typed path came back as
    "/sers/...". Callers that can read the field back should prefer
    `type_verified`.

    CAVEAT: every event carries virtual keycode 0 and relies on the attached
    unicode string. Text fields honour that string, but AppKit TYPE-AHEAD
    (file lists, sidebars, outline views) reads the KEYCODE instead and so
    sees a run of 'a'. Never drive a list selection with this.
    """
    for ch in text:
        for down in (True, False):
            ev = CGEventCreateKeyboardEvent(None, 0, down)
            CGEventKeyboardSetUnicodeString(ev, len(ch), ch)
            CGEventSetFlags(ev, 0)
            CGEventPost(kCGHIDEventTap, ev)
            time.sleep(0.012)
        time.sleep(per_char)


def type_verified(field, text, attempts=3):
    """Type `text` into `field`, reading it back through AX until it matches.

    Select-all first so each retry replaces the previous attempt rather than
    appending to it. Returns True once AXValue == text, False if every
    attempt was mangled — which the caller must treat as fatal, since a
    half-typed path silently navigates somewhere wrong instead of failing
    loudly.
    """
    for _ in range(attempts):
        press_key(KEY_A, kCGEventFlagMaskCommand, pause=0.35)
        type_text(text)
        time.sleep(1.0)
        if ax_get(field, AX_VALUE) == text:
            return True
    return False


def wait_for(fn, timeout=6.0, poll=0.2):
    """Poll fn() until it returns something truthy, then return it (else None).

    Mandatory for any read taken after synthetic input: Premiere's AX tree
    lags events by seconds, so a single sample regularly reports a dialog as
    missing while it is plainly on screen.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            value = fn()
        except Exception:  # noqa: BLE001 — AX calls can throw mid-transition
            value = None
        if value:
            return value
        time.sleep(poll)
    return None


def frontmost_pid():
    """PID of the app owning the frontmost on-screen window, queried LIVE from
    the window server (CGWindowList) — this is who will receive synthetic keys.

    Do NOT use NSWorkspace.frontmostApplication() / NSRunningApplication
    .isActive() here: those AppKit values only refresh when workspace
    notifications are pumped through an NSRunLoop, so in a short-lived CLI
    they stay STALE at their launch-time snapshot — which made
    `ensure_frontmost` report False while Premiere was actually frontmost.
    CGWindowList queries the window server directly, needs no run loop, and
    needs no Screen Recording permission for owner PID + layer (only window
    *titles* are gated on that).
    """
    info = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )
    # Windows come back front-to-back; the first at the normal window layer (0)
    # belongs to the frontmost regular app (skips menu bar / dock / overlays).
    for w in info or []:
        if (w.objectForKey_("kCGWindowLayer") or 0) == 0:
            return w.objectForKey_("kCGWindowOwnerPID")
    return None


def ensure_frontmost(app, timeout=3.0, poll=0.1, overlay=None):
    """Request activation, then BLOCK until the OS confirms Premiere is
    frontmost — so synthetic key/mouse events land in it and not whatever the
    user just clicked. Activation is async and can be DENIED (macOS
    focus-stealing prevention refuses background/CLI processes), so we verify
    rather than trust it: the window server's frontmost-app pid must match.

    Two methods are tried — NSWorkspace activation, then AX `AXFrontmost`
    (which sometimes succeeds when NSWorkspace is denied). Returns True on
    confirmation, False on timeout — in which case the caller MUST abort
    before sending input; the reliable fallback is for the user to click
    Premiere themselves.
    """
    pid = app.processIdentifier()

    def confirmed():
        # Live window-server check only — app.isActive() is stale without a run loop.
        return frontmost_pid() == pid

    # `wait` pumps the overlay's run loop when present (keeps the amber banner
    # live) and otherwise just sleeps.
    wait = overlay.sleep if overlay is not None else time.sleep
    if overlay is not None:
        overlay.waiting()

    app.activateWithOptions_(NSApplicationActivateIgnoringOtherApps)
    half = timeout / 2
    deadline = time.time() + half
    while time.time() < deadline:
        if confirmed():
            return True
        wait(poll)

    AXUIElementSetAttributeValue(app_ax_element(app), "AXFrontmost", True)
    deadline = time.time() + half
    while time.time() < deadline:
        if confirmed():
            return True
        wait(poll)
    return False



# Settle time after the window server confirms Premiere is frontmost:
# `frontmost_pid()` flips to Premiere as soon as macOS assigns it the front
# window, but the actual window-swap animation/redraw lags a bit behind
# that — e.g. `desktop-take-screenshot` fired right on confirmation could
# still capture a frame partway through the swap, showing a sliver of the
# previously-frontmost app. This is a fixed wait, not polled, since there's
# no observable signal for "swap animation finished."
FRONTMOST_SETTLE_SECONDS = 0.5


def _require_frontmost(app, overlay=None) -> bool:
    """Shared precondition for every `desktop-*` command: confirm Premiere
    is frontmost before sending any synthetic input, printing a
    `{"ok": False, ...}` JSON error on failure. Returns True once confirmed;
    on failure it has already printed the error, so the caller just needs
    to propagate exit code 3.

    If Premiere wasn't already frontmost, waits `FRONTMOST_SETTLE_SECONDS`
    after confirmation before returning, to let the window-swap animation
    finish (see that constant's docstring) — skipped when Premiere was
    already frontmost, since nothing was mid-swap."""
    already_frontmost = frontmost_pid() == app.processIdentifier()
    if ensure_frontmost(app, overlay=overlay):
        if not already_frontmost:
            wait = overlay.sleep if overlay is not None else time.sleep
            wait(FRONTMOST_SETTLE_SECONDS)
        return True
    if overlay:
        overlay.info("⚠️  Couldn't focus Premiere\nclick its window, then rerun")
        overlay.sleep(2.0)
    print(json.dumps({
        "ok": False,
        "error": "could not confirm Premiere is frontmost — aborting before sending input",
        "frontmostPid": frontmost_pid(),
        "premierePid": app.processIdentifier(),
    }))
    return False


def _make_overlay():
    """Best-effort: return an Overlay, or None if it can't be created (keeps
    the driver usable if pyobjc AppKit windowing is unavailable, e.g. no
    active login session)."""
    try:
        from premiere_cli import desktop_overlay

        return desktop_overlay.Overlay()
    except Exception:  # noqa: BLE001 — overlay is optional UX, never fatal
        return None


# ----------------------------------------------------------------------------
# Generic desktop-driving primitives
#
# A screenshot, one key press, literal text entry, a mouse move, a mouse
# click — raw building blocks for whatever Premiere-specific automation
# gets built on top of them. Each confirms Premiere is frontmost first via
# `_require_frontmost`, since they post real synthetic input.
# ----------------------------------------------------------------------------
def take_screenshot(output_path: str, port: int = DEFAULT_PANEL_PORT) -> int:
    """DRIVE: confirm Premiere is frontmost, then save a full-screen
    screenshot to `output_path` via the `screencapture` CLI (`-x` suppresses
    the shutter sound — consistent with every screenshot taken while
    developing this module).

    Prints one JSON object and returns a process exit code: 0 ok, 1
    Premiere not running, 3 couldn't confirm frontmost, 5 `screencapture`
    itself failed or produced no file.

    Unlike the other `desktop-*` primitives, this hides the status overlay
    (rather than showing "driving") right before capturing — the overlay
    is a real always-on-top window and `screencapture -x` captures the
    whole screen, so leaving it up would bake its banner into the corner
    of every screenshot.
    """
    output_path = os.path.abspath(os.path.expanduser(output_path))

    app = find_premiere()
    if app is None:
        print(json.dumps({"ok": False, "error": "Premiere Pro not running"}))
        return 1

    overlay = _make_overlay()
    try:
        if not _require_frontmost(app, overlay):
            return 3

        if overlay:
            overlay.hide()

        parent = os.path.dirname(output_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        proc = subprocess.run(
            ["screencapture", "-x", output_path],
            capture_output=True, text=True, timeout=15,
        )
        if proc.returncode != 0 or not os.path.isfile(output_path):
            print(json.dumps({
                "ok": False,
                "error": f"screencapture failed (exit {proc.returncode}): {proc.stderr.strip()}",
            }))
            return 5

        print(json.dumps({
            "ok": True,
            "path": output_path,
            "fileSizeBytes": os.path.getsize(output_path),
        }))
        if overlay:
            overlay.done()
            overlay.sleep(1.0)
        return 0
    finally:
        if overlay:
            overlay.hide()


def press_key_by_name(key: str, modifiers=(), port: int = DEFAULT_PANEL_PORT) -> int:
    """DRIVE: confirm Premiere is frontmost, then send one synthetic key
    press (down+up) via `press_key`. `key` is either a name from
    `KEY_NAMES` or a decimal virtual-keycode string; `modifiers` is any
    subset of `MODIFIER_FLAGS`'s keys, combined into one CGEvent flag mask.

    This posts a raw, unattributed key event — exactly like a physical key
    press. For literal unicode text (which needs a different, keycode-0
    event carrying the actual character — punctuation and non-US-layout
    characters included), use `desktop-enter-text` instead.

    Prints one JSON object and returns a process exit code: 0 ok, 1
    Premiere not running, 2 unknown key/modifier name, 3 couldn't confirm
    frontmost.
    """
    key_lower = key.lower()
    if key_lower in KEY_NAMES:
        keycode = KEY_NAMES[key_lower]
    elif key.isdigit():
        keycode = int(key)
    else:
        print(json.dumps({
            "ok": False,
            "error": f"unknown key {key!r} — use a name from KEY_NAMES or a decimal keycode",
        }))
        return 2

    flags = 0
    for name in modifiers:
        if name.lower() not in MODIFIER_FLAGS:
            print(json.dumps({
                "ok": False,
                "error": f"unknown modifier {name!r} — use one of {sorted(set(MODIFIER_FLAGS))}",
            }))
            return 2
        flags |= MODIFIER_FLAGS[name.lower()]

    app = find_premiere()
    if app is None:
        print(json.dumps({"ok": False, "error": "Premiere Pro not running"}))
        return 1

    overlay = _make_overlay()
    try:
        if not _require_frontmost(app, overlay):
            return 3

        if overlay:
            overlay.driving(f"pressing {key} — don't touch input")

        press_key(keycode, flags=flags)

        print(json.dumps({
            "ok": True, "key": key, "keycode": keycode, "modifiers": list(modifiers),
        }))
        if overlay:
            overlay.done()
            overlay.sleep(0.5)
        return 0
    finally:
        if overlay:
            overlay.hide()


def enter_text(text: str, port: int = DEFAULT_PANEL_PORT) -> int:
    """DRIVE: confirm Premiere is frontmost, then type `text` as literal
    unicode (`type_text`) at the current insertion point — no select-all,
    no clearing, no validation. For a field whose resulting value should be
    checked afterward, use `desktop-enter-text-with-validate` instead.

    Prints one JSON object and returns a process exit code: 0 ok, 1
    Premiere not running, 3 couldn't confirm frontmost.
    """
    app = find_premiere()
    if app is None:
        print(json.dumps({"ok": False, "error": "Premiere Pro not running"}))
        return 1

    overlay = _make_overlay()
    try:
        if not _require_frontmost(app, overlay):
            return 3

        if overlay:
            overlay.driving("entering text — don't touch input")

        type_text(text)

        print(json.dumps({"ok": True, "text": text}))
        if overlay:
            overlay.done()
            overlay.sleep(0.5)
        return 0
    finally:
        if overlay:
            overlay.hide()


def enter_text_with_validate(text: str, attempts: int = 3, port: int = DEFAULT_PANEL_PORT) -> int:
    """DRIVE: confirm Premiere is frontmost, then type `text` into whatever
    field currently has keyboard focus (`AXFocusedUIElement`), verifying by
    reading that field's `AXValue` back afterward — the same discipline as
    `type_verified`, generalized to whatever's focused rather than a
    specific known field. Selects-all (Cmd-A) before each attempt so a
    retry REPLACES the previous one rather than appending to it — see
    `type_verified` for why that matters.

    CAVEAT (live-tested 2026-07-23): Premiere's app-wide
    `AXFocusedUIElement` does NOT reliably track its own custom-drawn
    panels — clicking into the Project panel's search field and calling
    this immediately after still read back an unrelated, stale combobox
    (`"Select Zoom Level"`/`"Fit"`) as "focused," even though the text
    itself landed in the right place (confirmed separately via
    `desktop-enter-text` + a screenshot). This command will most likely
    report a false mismatch (exit 4) against Premiere's own panels for that
    reason — it's only reliable against a genuinely native AX-compliant
    field addressed directly (by reference, not by asking what's
    "focused"). For typing into Premiere's own UI, prefer plain
    `desktop-enter-text` and verify success visually
    (`desktop-take-screenshot`) instead.

    Prints one JSON object and returns a process exit code: 0 verified
    match, 1 Premiere not running, 2 no focused element to validate
    against, 3 couldn't confirm frontmost, 4 typed but the read-back never
    matched after `attempts` tries.
    """
    app = find_premiere()
    if app is None:
        print(json.dumps({"ok": False, "error": "Premiere Pro not running"}))
        return 1

    overlay = _make_overlay()
    try:
        if not _require_frontmost(app, overlay):
            return 3

        el = app_ax_element(app)
        field = ax_get(el, AX_FOCUSED_UI_ELEMENT)
        if field is None:
            print(json.dumps({
                "ok": False,
                "error": "no focused UI element to validate against — click into a field first",
            }))
            return 2

        if overlay:
            overlay.driving("entering text — don't touch input")

        verified = type_verified(field, text, attempts=attempts)
        actual = ax_get(field, AX_VALUE)

        result = {"ok": verified, "text": text, "actualValue": actual}
        if not verified:
            result["error"] = f"field reads {actual!r} after {attempts} attempt(s), expected {text!r}"
        print(json.dumps(result))

        if overlay:
            if verified:
                overlay.done()
            else:
                overlay.info(f"⚠️  field reads {actual!r}")
            overlay.sleep(1.0)
        return 0 if verified else 4
    finally:
        if overlay:
            overlay.hide()


def move_mouse(x: float, y: float, port: int = DEFAULT_PANEL_PORT) -> int:
    """DRIVE: confirm Premiere is frontmost, then move the mouse cursor to
    screen coordinates (x, y) via a real CGEvent move — e.g. to hover
    something, or position the cursor ahead of a separate
    `desktop-click-mouse` call.

    Prints one JSON object and returns a process exit code: 0 ok, 1
    Premiere not running, 3 couldn't confirm frontmost.
    """
    app = find_premiere()
    if app is None:
        print(json.dumps({"ok": False, "error": "Premiere Pro not running"}))
        return 1

    overlay = _make_overlay()
    try:
        if not _require_frontmost(app, overlay):
            return 3

        if overlay:
            overlay.driving(f"moving mouse to ({x:.0f}, {y:.0f}) — don't touch input")

        move = CGEventCreateMouseEvent(None, kCGEventMouseMoved, (x, y), kCGMouseButtonLeft)
        CGEventPost(kCGHIDEventTap, move)

        print(json.dumps({"ok": True, "x": x, "y": y}))
        if overlay:
            overlay.done()
            overlay.sleep(0.3)
        return 0
    finally:
        if overlay:
            overlay.hide()


def click_mouse(x=None, y=None, button: str = "left", port: int = DEFAULT_PANEL_PORT) -> int:
    """DRIVE: confirm Premiere is frontmost, then click the mouse — at
    (x, y) if both are given, else at the CURRENT cursor position (read
    live via `CGEventGetLocation`, not cached). `button` is `"left"` or
    `"right"`.

    Re-checks Premiere is still frontmost immediately before the down/up,
    since focus can slip in the gap between the initial confirmation and
    the click itself.

    Prints one JSON object and returns a process exit code: 0 ok, 1
    Premiere not running, 2 invalid button or only one of x/y given, 3
    couldn't confirm frontmost (initially, or right before the click).
    """
    if button not in ("left", "right"):
        print(json.dumps({"ok": False, "error": f"invalid button {button!r} — use 'left' or 'right'"}))
        return 2
    if (x is None) != (y is None):
        print(json.dumps({"ok": False, "error": "x and y must be given together, or neither"}))
        return 2

    app = find_premiere()
    if app is None:
        print(json.dumps({"ok": False, "error": "Premiere Pro not running"}))
        return 1

    overlay = _make_overlay()
    try:
        if not _require_frontmost(app, overlay):
            return 3

        if x is None:
            location = CGEventGetLocation(CGEventCreate(None))
            click_x, click_y = location.x, location.y
        else:
            click_x, click_y = x, y

        if overlay:
            overlay.driving(f"{button}-clicking ({click_x:.0f}, {click_y:.0f}) — don't touch input")

        if frontmost_pid() != app.processIdentifier():
            print(json.dumps({
                "ok": False,
                "error": "Premiere lost frontmost right before the click — aborting",
            }))
            return 3

        down_type = kCGEventLeftMouseDown if button == "left" else kCGEventRightMouseDown
        up_type = kCGEventLeftMouseUp if button == "left" else kCGEventRightMouseUp
        cg_button = kCGMouseButtonLeft if button == "left" else kCGMouseButtonRight

        down = CGEventCreateMouseEvent(None, down_type, (click_x, click_y), cg_button)
        up = CGEventCreateMouseEvent(None, up_type, (click_x, click_y), cg_button)
        CGEventPost(kCGHIDEventTap, down)
        time.sleep(0.05)
        CGEventPost(kCGHIDEventTap, up)

        print(json.dumps({"ok": True, "x": click_x, "y": click_y, "button": button}))
        if overlay:
            overlay.done()
            overlay.sleep(0.3)
        return 0
    finally:
        if overlay:
            overlay.hide()


# ----------------------------------------------------------------------------
# Persistent notification window (`desktop-notify` / `desktop-dismiss-
# notifications`) — separate daemon process, see `notify_daemon.py` for why.
# ----------------------------------------------------------------------------
def _post_notify_daemon(path: str, body: dict, timeout: float = 2.0) -> dict:
    """POST to the notify daemon's local HTTP server. Never raises — folds
    connection failures (most commonly: daemon not running) into
    `{"ok": False, "error": "..."}` so callers decide what that means."""
    from premiere_cli.notify_daemon import NOTIFY_DAEMON_PORT

    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{NOTIFY_DAEMON_PORT}{path}",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}


def notify(message: str, state: str = "info") -> int:
    """Show (or update, if one is already up) an always-on-top notification
    window pinned top-right of the screen — via the separate, persistent
    `notify_daemon` process, so a LATER `desktop-notify`/`desktop-dismiss-
    notifications` call (a different CLI invocation) updates or closes the
    SAME window instead of popping up a new one each time.

    `state` is `"waiting"` (amber), `"driving"` (red), `"done"` (green), or
    `"info"` (slate) — same accent palette `desktop_overlay.Overlay` uses
    elsewhere in this module.

    If no daemon is running yet, spawns one (detached via
    `start_new_session`, so it outlives this process) and polls until it's
    reachable before sending the update. Prints one JSON object and returns
    a process exit code: 0 ok, 5 the daemon couldn't be reached even after
    spawning it.
    """
    result = _post_notify_daemon("/update", {"message": message, "state": state})

    if not result.get("ok"):
        subprocess.Popen(
            [sys.executable, "-m", "premiere_cli.notify_daemon"],
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
        )
        deadline = time.time() + 5.0
        while time.time() < deadline:
            result = _post_notify_daemon("/update", {"message": message, "state": state})
            if result.get("ok"):
                break
            time.sleep(0.2)

    if not result.get("ok"):
        print(json.dumps({
            "ok": False,
            "error": f"could not reach the notify daemon after starting it: {result.get('error')}",
        }))
        return 5

    print(json.dumps({"ok": True, "message": message, "state": state}))
    return 0


def dismiss_notifications() -> int:
    """Hide and terminate the notify daemon (see `notify`), if one is
    running. Idempotent: no daemon running is a normal, truthful
    `{"ok": True, "wasRunning": False}`, not an error.
    """
    result = _post_notify_daemon("/quit", {})
    print(json.dumps({"ok": True, "wasRunning": bool(result.get("ok"))}))
    return 0
