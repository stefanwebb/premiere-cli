"""macOS desktop driver (pyobjc) — layer-1/2 UI automation for Premiere Pro.

Drives native macOS UI (menus, standard open/save panels) through the
Accessibility API + synthetic key events, for actions Premiere's
ExtendScript/QE APIs don't expose. First (and so far only) target: set a
Lumetri "Input LUT" from a .cube path — `apply-lut` can't do this on this
build (Input LUT is a registry-backed dropdown, so a plain path string is
rejected — see `panel/host/commands/apply-lut.jsx` for the full finding).

macOS only — imports Cocoa/ApplicationServices/Quartz unconditionally, so
this module must only ever be imported lazily (see `cli.py`'s dispatch for
`desktop-set-input-lut`), never at package-import time, so the rest of the
CLI stays usable without the `macos-desktop` extra installed.

Layering (most robust first):
  1. Accessibility API — semantic, coordinate-free. Great for the menu bar and
     the native NSOpenPanel; weak for Premiere's custom-drawn Lumetri panel.
  2. Synthetic key events (CGEvent) — keyboard chords + unicode typing.
  3. (not needed) screenshot + vision. The whole flow turned out to be doable
     with 1 + 2; nothing here hit-tests pixels or hardcodes a coordinate.

DRIVE operations post real mouse/key events, which macOS routes to whatever
app is FRONTMOST — so Premiere must stay active and the user must keep hands
off the keyboard/mouse while they run, or the events land in the wrong app.
(`AXPress` on a specific button is the exception: it targets the element
directly and works regardless of focus.)

What was established building this against a live Premiere 2026:
  - Premiere's AX tree is unusually rich: the Lumetri "Input LUT" combobox is
    locatable by CONTENT — the one AXComboBox whose children include a
    "Browse..." label — so no coordinate or panel-layout assumption is needed.
  - The dropdown's items are custom-drawn — AXUnknown, zero geometry, no
    actions — so they can't be pressed or hit-tested. But the open dropdown
    IS keyboard-navigable, and AX still reports the item LIST plus the
    combobox's current value, so the target is reachable by pressing Down
    exactly (index(target) - index(current)) times. Fully coordinate-free.
  - The file dialog opens as an [AXWindow AXDialog] on Premiere's OWN process
    (Premiere isn't sandboxed, so NSOpenPanel runs in-process) and its
    Cancel/Open buttons are AX-pressable.
  - The same content + keyboard-nav technique reaches Effect Controls' "Add
    Lumetri Color Effect" item too, when the clip has no Lumetri Color yet
    (see `ensure_lumetri_color`).

Three things made the file-dialog flow look impossible for a while, all
fixed here:
  - `type_text` posted characters far too fast for Premiere's busy main
    thread and silently DROPPED some — a typed path arrived as "/sers/..." —
    so the panel navigated nowhere and Open never enabled. Typing is now
    paced and, where it matters, read back through AX and retried until it
    matches (`type_verified`).
  - Selecting the file by TYPE-AHEAD can never work: every synthetic
    character carries virtual keycode 0, and AppKit type-ahead reads the
    keycode rather than the attached unicode string, so the file list only
    ever saw "aaaa…". Cmd-Shift-G with the FULL FILE PATH selects the file
    directly instead.
  - Premiere's AX tree lags synthetic input by seconds. A single read taken
    right after driving routinely reports a dialog as absent while it is
    plainly on screen, so every post-input read polls (`wait_for`) instead of
    trusting one sample.

See docs/DESKTOP_DRIVER_NOTES.md for the full, dated finding log.
"""

import json
import os
import time
import urllib.error
import urllib.request

from AppKit import NSApplicationActivateIgnoringOtherApps, NSWorkspace
from ApplicationServices import (
    AXUIElementCreateApplication,
    AXUIElementCopyAttributeValue,
    AXUIElementPerformAction,
    AXUIElementSetAttributeValue,
)
from Quartz import (
    CGEventCreateKeyboardEvent,
    CGEventKeyboardSetUnicodeString,
    CGEventPost,
    CGEventSetFlags,
    CGWindowListCopyWindowInfo,
    kCGHIDEventTap,
    kCGEventFlagMaskCommand,
    kCGEventFlagMaskShift,
    kCGNullWindowID,
    kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly,
)

PREMIERE_BUNDLE_ID = "com.adobe.PremierePro.26"
LUT_DIALOG_TITLE = "Select a LUT"
DEFAULT_PANEL_PORT = 47823

# AX attribute/action names as string literals (stable across pyobjc versions).
AX_CHILDREN = "AXChildren"
AX_ROLE = "AXRole"
AX_SUBROLE = "AXSubrole"
AX_TITLE = "AXTitle"
AX_VALUE = "AXValue"
AX_DESC = "AXDescription"
AX_WINDOWS = "AXWindows"
AX_PRESS = "AXPress"

# Virtual keycodes for chords / navigation / confirmation.
KEY_A = 0
KEY_G = 5
KEY_RETURN = 36
KEY_DOWN = 125
KEY_UP = 126


# ----------------------------------------------------------------------------
# Accessibility reads
# ----------------------------------------------------------------------------
def ax_get(element, attr):
    """Copy one AX attribute; return None on any error (0 == kAXErrorSuccess)."""
    err, val = AXUIElementCopyAttributeValue(element, attr, None)
    return val if err == 0 else None


def ax_children(element):
    return ax_get(element, AX_CHILDREN) or []


def ax_label(element):
    """A human-readable label for an element, best-effort across attributes."""
    for attr in (AX_TITLE, AX_DESC, AX_VALUE):
        v = ax_get(element, attr)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


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


def search(element, predicate, budget=6000):
    """Depth-first collect elements matching predicate(role, subrole, label).

    Iterative (explicit stack), not recursive: live testing hit a
    RecursionError against Premiere's real AX tree — depth alone can exceed
    Python's default recursion limit (~1000), and a cyclic AX relationship
    (element A's descendant referencing back to A) would recurse forever.
    `budget` bounds total nodes visited either way; iteration removes the
    separate, unrelated depth limit that recursion was silently imposing.
    """
    found = []
    stack = [element]
    while stack and budget > 0:
        current = stack.pop()
        budget -= 1
        role = ax_get(current, AX_ROLE) or ""
        subrole = ax_get(current, AX_SUBROLE) or ""
        label = ax_label(current)
        if predicate(role, subrole, label):
            found.append((current, role, subrole, label))
        stack.extend(ax_children(current))
    return found


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


# ----------------------------------------------------------------------------
# Custom-drawn dropdown navigation (shared by the Input LUT combobox and the
# Effect Controls "Add Lumetri Color Effect" combobox — same custom-drawn,
# AXUnknown-item shape, same fix)
# ----------------------------------------------------------------------------
def _combobox_containing(app_el, item_label):
    """The AXComboBox whose children include `item_label` — content-based
    lookup, immune to workspace layout, position, and current-value changes."""
    for element, _role, _sub, _label in search(app_el, lambda r, s, l: r == "AXComboBox"):
        labels = [ax_label(child) for child in ax_children(element)]
        if item_label in labels:
            return element, labels
    return None, []


def _navigation_steps(labels, current, target_label):
    """Pure: given an open dropdown's item labels, its current value, and the
    label to reach, return (needs_reset_to_top, key, steps).

    - needs_reset_to_top=False: press `key` `steps` times from wherever the
      list currently is (`current` is a known position in `labels`).
    - needs_reset_to_top=True: `current` isn't in `labels` at all — e.g.
      Premiere renames the "[Custom]" slot to whatever LUT is currently
      applied, so a value that was itself once a list entry can vanish from
      the next lookup. The caller should press Up `len(labels)` times first
      (Premiere clamps at the top) and then Down `steps` times.

    Raises ValueError if target_label isn't in labels — callers should
    already have confirmed the target exists before navigating to it.
    """
    target = labels.index(target_label)
    if current in labels:
        delta = target - labels.index(current)
        return False, (KEY_DOWN if delta >= 0 else KEY_UP), abs(delta)
    return True, KEY_DOWN, target


def _select_dropdown_item(combo, labels, target_label):
    """With `combo` already AX-pressed open, navigate to `target_label` via
    arrow keys and press Return to select it."""
    current = ax_get(combo, AX_VALUE)
    reset, key, steps = _navigation_steps(labels, current, target_label)
    if reset:
        for _ in range(len(labels)):
            press_key(KEY_UP, pause=0.05)
    for _ in range(steps):
        press_key(key, pause=0.15)
    press_key(KEY_RETURN, pause=0.5)


def _open_and_select(find_combo, target_label, verify, timeout=8.0, attempts=2):
    """Press-open a dropdown, navigate to `target_label`, and confirm via
    `verify()` — retrying the whole attempt (fresh AXPress included) if it
    doesn't come true in time.

    A single AXPress on the combobox occasionally has no visible effect: live
    testing found a case where `ensure_frontmost` had already confirmed
    Premiere owns the frontmost window, yet the FIRST press on this specific
    control didn't open it — the second, identical press did. AX reports
    AXPress as successful either way, so there's no error to catch; only
    `verify()` not becoming true reveals it. `find_combo` re-locates the
    combobox fresh on each attempt rather than reusing a possibly-stale
    reference to the same AX element.
    """
    for _ in range(attempts):
        combo, labels = find_combo()
        if combo is None:
            return False
        AXUIElementPerformAction(combo, AX_PRESS)
        time.sleep(0.8)
        _select_dropdown_item(combo, labels, target_label)
        if wait_for(verify, timeout=timeout / attempts) is not None:
            return True
    return False


# ----------------------------------------------------------------------------
# Lumetri Color effect + Input LUT dropdown
# ----------------------------------------------------------------------------
def input_lut_combobox(app_el):
    """The Lumetri "Input LUT" combobox, found by CONTENT: the only
    AXComboBox whose children include "Browse...". Returns (element, [labels]),
    or (None, []).

    Matching on content rather than position or value survives workspace
    layout changes and clips that already have a LUT applied (whose value is
    the LUT name, not "None"). Requires a clip selected and Lumetri Color >
    Basic Correction visible, or the combobox simply isn't in the tree.
    """
    return _combobox_containing(app_el, "Browse...")


def find_lut_dialog(app_el):
    return next(
        (w for w in (ax_get(app_el, AX_WINDOWS) or []) if ax_get(w, AX_TITLE) == LUT_DIALOG_TITLE),
        None,
    )


def lumetri_color_present(app_el, timeout=3.0) -> bool:
    """Poll for the Input LUT combobox rather than taking a single read.

    Live testing found the Input LUT combobox transiently unreadable right
    after a preceding drive operation (e.g. the file dialog from a prior
    `set_input_lut` call closing) even though Lumetri Color was never
    actually removed — the same AX-tree-lags-input phenomenon documented on
    `wait_for`, just encountered on an ABSENCE check instead of a presence
    check. Trusting a single negative read here risks `ensure_lumetri_color`
    clicking "Add Lumetri Color Effect" on a clip that already has one.
    """
    return wait_for(lambda: input_lut_combobox(app_el)[0] is not None, timeout) is not None


def ensure_lumetri_color(app_el, timeout=8.0) -> bool:
    """Add the Lumetri Color effect to the selected clip if it doesn't already
    have one. Returns True if Lumetri Color ends up applied (already there,
    or successfully added), False otherwise.

    Uses the same content-lookup + keyboard-nav technique as the Input LUT
    dropdown, pointed at a different control: Effect Controls' "Select
    Effect" combobox has an "Add Lumetri Color Effect" item. Verifies by
    re-checking `input_lut_combobox` rather than trusting the click —
    same discipline as everything else here.

    Returns False (rather than raising) if the "Add Lumetri Color Effect"
    control can't be found — e.g. Effect Controls isn't visible, or nothing
    is selected. Callers should treat that as a precondition failure with an
    actionable message, since there's a reliable DOM-side fallback
    (`premiere-cli apply-effect --effect-name "Lumetri Color" ...`) that
    needs only track/clip addressing this driver doesn't have.
    """
    if lumetri_color_present(app_el):
        return True

    if _combobox_containing(app_el, "Add Lumetri Color Effect")[0] is None:
        return False

    return _open_and_select(
        lambda: _combobox_containing(app_el, "Add Lumetri Color Effect"),
        "Add Lumetri Color Effect",
        lambda: input_lut_combobox(app_el)[0] is not None,
        timeout=timeout,
    )


def open_lut_browse_panel(app_el, timeout=8.0) -> bool:
    """Open Input LUT > Browse… and wait for the "Select a LUT" dialog.

    The dropdown items are custom-drawn — AXUnknown, zero geometry, no
    actions — so "Browse..." cannot be pressed or hit-tested. It can however
    be REACHED: AXPress opens the dropdown, AX still reports the item list
    and the current value, and the open list responds to arrow keys.
    """
    if input_lut_combobox(app_el)[0] is None:
        return False
    return _open_and_select(
        lambda: input_lut_combobox(app_el),
        "Browse...",
        lambda: find_lut_dialog(app_el),
        timeout=timeout,
    )


# ----------------------------------------------------------------------------
# Native open/save panel driver (the reliable win)
# ----------------------------------------------------------------------------
def goto_folder_field(app_el):
    """The focused text field of an open Cmd-Shift-G "Go to Folder" sheet."""
    dialog = find_lut_dialog(app_el)
    if dialog is None:
        return None
    for element, _role, _sub, _label in search(dialog, lambda r, s, l: r == "AXTextField"):
        if ax_get(element, "AXFocused"):
            return element
    return None


def drive_open_panel_to(path, app_el, timeout=15.0):
    """With a native file open panel already frontmost, select `path` and
    confirm.

    ONE phase, not two: Cmd-Shift-G accepts the FULL FILE PATH — directory
    plus filename — and selects that file outright, which is what enables
    Open. A two-phase design (go to the DIRECTORY, then type-ahead the
    FILENAME) can never work: type-ahead reads the virtual keycode, which
    `type_text` always sets to 0, so the file list would see "aaaa…" and
    wander off to whatever matched. The path is typed through
    `type_verified` because a dropped character fails the same silent way.

    Requires Premiere frontmost — go-to-folder is synthetic keyboard input,
    which macOS routes to the focused app. Returns a status string; the
    caller opens the panel (`open_lut_browse_panel`) beforehand.
    """
    name = os.path.basename(path)

    # Only summon the sheet if one isn't already up. Never "clear" it with
    # Escape first: with no sheet open, Escape cancels the whole panel, and
    # the go-to-folder chord then lands on a dialog that no longer exists.
    # type_verified select-alls anyway, so a pre-filled sheet is harmless.
    if goto_folder_field(app_el) is None:
        press_key(KEY_G, kCGEventFlagMaskCommand | kCGEventFlagMaskShift, pause=0.3)
    field = wait_for(lambda: goto_folder_field(app_el), timeout=6.0)
    if field is None:
        return "go-to-folder sheet never opened"
    if not type_verified(field, path):
        return f"path kept coming back mangled — {ax_get(field, AX_VALUE)!r}"
    press_key(KEY_RETURN, pause=0.3)

    # Confirm only when a file is selected — Open is disabled until then.
    def enabled_confirm():
        dialog = find_lut_dialog(app_el)
        if dialog is None:
            return None
        for element, _role, _sub, label in search(
            dialog, lambda r, s, l: r == "AXButton" and l.strip().lower() in ("open", "choose", "import")
        ):
            if ax_get(element, "AXEnabled"):
                return element, label
        return None

    hit = wait_for(enabled_confirm, timeout)
    if hit is None:
        return f"confirm button never enabled — {name!r} not selected"
    element, label = hit
    AXUIElementPerformAction(element, AX_PRESS)
    return f"selected {name!r}, pressed {label!r} via AX"


# ----------------------------------------------------------------------------
# CLI entry point
# ----------------------------------------------------------------------------
def selected_clip_names(port=DEFAULT_PANEL_PORT, timeout=5.0):
    """The names of currently-selected timeline clips, via the SAME
    /command endpoint every other premiere-cli command uses (`get-premiere-
    state`) — not an AX read.

    This driver otherwise never touches the panel — it exists specifically
    for when the panel's ExtendScript path can't do something (setting
    Input LUT). But "how many clips are selected" is exactly the kind of
    thing the DOM answers cleanly and the screen doesn't: live testing found
    the Lumetri panel shows "Multiple clips selected" in that state instead
    of Basic Correction, but hunting that text via AX proved fragile
    (tab-dependent, not always in the tree) where the DOM's `getSelection()`
    is reliable and already exercised by `get-premiere-state`.

    Raises RuntimeError (actionable message) if the panel can't be reached
    or errors — deliberately NOT best-effort, since the one caller
    (`set_input_lut`) uses this as a safety precondition: driving the LUT
    picker while multiple clips are selected applies the change to ALL of
    them at once (live-confirmed), so an unverifiable selection should stop
    the command, not let it proceed blind.
    """
    payload = json.dumps({"command": "get-premiere-state", "args": {}}).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise RuntimeError(
            f"could not reach the Premiere Bridge panel on port {port} to check clip "
            f"selection (is the panel open in Premiere Pro?): {exc}"
        ) from exc
    if not body.get("ok"):
        raise RuntimeError(f"panel rejected get-premiere-state: {body.get('error', 'unknown error')}")
    selection = (body.get("result") or {}).get("selection")
    if selection is None:
        raise RuntimeError("panel returned no selection info (get-premiere-state)")
    return [item.get("name") for item in selection]


def _make_overlay():
    """Best-effort: return an Overlay, or None if it can't be created (keeps
    the driver usable if pyobjc AppKit windowing is unavailable, e.g. no
    active login session)."""
    try:
        from premiere_cli import desktop_overlay

        return desktop_overlay.Overlay()
    except Exception:  # noqa: BLE001 — overlay is optional UX, never fatal
        return None


def set_input_lut(path: str, port: int = DEFAULT_PANEL_PORT) -> int:
    """DRIVE end-to-end: set the selected clip's Lumetri Input LUT to `path`.

    Checks exactly one clip is selected (`selected_clip_names`) — driving
    the LUT picker while multiple clips are selected applies the change to
    ALL of them at once, live-confirmed. Ensures Lumetri Color is applied
    (adding it if missing, see `ensure_lumetri_color`), opens Input LUT >
    Browse… (`open_lut_browse_panel`) and drives the file panel
    (`drive_open_panel_to`), then VERIFIES by reading the combobox back —
    pressing Open is not proof the LUT was accepted. Keep Premiere frontmost
    and hands off the keyboard while this runs.

    Prints one JSON object to stdout (matching every other premiere-cli
    command) and returns a process exit code: 0 ok, 1 bad path/Premiere not
    running, 2 a precondition couldn't be satisfied, 3 couldn't confirm
    Premiere frontmost, 4 the post-drive verification didn't match.
    """
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isfile(path):
        print(json.dumps({"ok": False, "error": f"no such file: {path}"}))
        return 1

    try:
        names = selected_clip_names(port=port)
    except RuntimeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    if len(names) != 1:
        print(json.dumps({
            "ok": False,
            "error": f"expected exactly one clip selected, found {len(names)} {names!r} — "
                     "select exactly one clip before setting its Input LUT.",
            "selectedClips": names,
        }))
        return 2

    app = find_premiere()
    if app is None:
        print(json.dumps({"ok": False, "error": "Premiere Pro not running"}))
        return 1

    overlay = _make_overlay()
    try:
        if not ensure_frontmost(app, overlay=overlay):
            if overlay:
                overlay.info("⚠️  Couldn't focus Premiere\nclick its window, then rerun")
                overlay.sleep(2.0)
            print(json.dumps({
                "ok": False,
                "error": "could not confirm Premiere is frontmost — aborting before sending input",
                "frontmostPid": frontmost_pid(),
                "premierePid": app.processIdentifier(),
            }))
            return 3

        el = app_ax_element(app)

        if overlay:
            overlay.driving("checking Lumetri Color — don't touch input")
        applied_lumetri_color = False
        if not lumetri_color_present(el):
            applied_lumetri_color = ensure_lumetri_color(el)
            if not applied_lumetri_color:
                if overlay:
                    overlay.info("⚠️  No Lumetri Color on this clip\nselect a clip, open Effect Controls")
                    overlay.sleep(2.0)
                print(json.dumps({
                    "ok": False,
                    "error": (
                        "no Lumetri Color effect on the selected clip, and the Effect "
                        "Controls 'Add Lumetri Color Effect' control wasn't found (is a "
                        "clip selected, and is Effect Controls open?). Add Lumetri Color "
                        "manually, or via: premiere-cli apply-effect "
                        "--effect-name \"Lumetri Color\" --track-type ... --track-index ... "
                        "--clip-index ..."
                    ),
                }))
                return 2

        if overlay:
            overlay.driving("setting the Input LUT — don't touch input")

        if find_lut_dialog(el) is None and not open_lut_browse_panel(el):
            print(json.dumps({
                "ok": False,
                "error": "could not open the 'Select a LUT' panel via Input LUT > Browse…",
            }))
            return 2

        drive_result = drive_open_panel_to(path, el)

        # Verify: the combobox should now read the LUT's filename stem.
        expected = os.path.splitext(os.path.basename(path))[0]
        combo, _labels = input_lut_combobox(el)
        actual = wait_for(lambda: ax_get(combo, AX_VALUE), timeout=5.0) if combo is not None else None
        ok = actual == expected

        result = {
            "ok": ok,
            "path": path,
            "appliedLumetriColor": applied_lumetri_color,
            "driveResult": drive_result,
            "expectedInputLut": expected,
            "actualInputLut": actual,
        }
        if not ok:
            result["error"] = f"Input LUT reads {actual!r}, expected {expected!r}"
        print(json.dumps(result))

        if overlay:
            overlay.done() if ok else overlay.info(f"⚠️  Input LUT reads {actual!r}")
            overlay.sleep(1.5)
        return 0 if ok else 4
    finally:
        if overlay:
            overlay.hide()
