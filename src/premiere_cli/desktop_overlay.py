"""Always-on-top status overlay for the desktop driver (pyobjc).

A small borderless panel pinned top-right of the screen that tells the user
what `desktop_driver` is doing — critically, WHEN to keep hands off the
keyboard and mouse. Two live states:

  - WAITING  (amber): activating Premiere / polling until the OS confirms it's
    frontmost. The user may still be interacting; nothing is being typed yet.
  - DRIVING  (red):   synthetic keys/clicks are going to Premiere right now —
    the user must not touch input or the events land in the wrong app.

Design constraints that make it safe to use *while* driving Premiere:

  - Accessory activation policy + a NON-ACTIVATING panel + orderFrontRegardless
    (never makeKeyAndOrderFront / activate): showing or updating the overlay
    does NOT steal focus, so it can't disturb Premiere's frontmost status.
  - Status window level: the panel sits above normal windows AND above the
    layer-0 windows that `desktop_driver.frontmost_pid()` inspects — so the
    overlay is never mistaken for the frontmost app.
  - ignoresMouseEvents: clicks pass straight through; it never intercepts input.
  - canJoinAllSpaces + fullScreenAuxiliary: stays visible across spaces and
    over a fullscreen Premiere.

The overlay needs a pumped run loop to paint. `sleep()` pumps the run loop for
the given duration instead of blocking — so callers replace `time.sleep(...)`
with `overlay.sleep(...)` during driving and the banner stays live/animated.
"""

from AppKit import (
    NSApplication,
    NSApplicationActivationPolicyAccessory,
    NSBackingStoreBuffered,
    NSColor,
    NSFont,
    NSMakeRect,
    NSPanel,
    NSScreen,
    NSTextField,
    NSView,
    NSWindowCollectionBehaviorCanJoinAllSpaces,
    NSWindowCollectionBehaviorFullScreenAuxiliary,
    NSWindowCollectionBehaviorStationary,
    NSStatusWindowLevel,
    NSWindowStyleMaskBorderless,
    NSWindowStyleMaskNonactivatingPanel,
)
from Foundation import NSDate, NSRunLoop

_WIDTH, _HEIGHT, _MARGIN = 400, 84, 22

# (r, g, b) accents per state; text is always white.
_AMBER = (0.90, 0.58, 0.10)
_RED = (0.82, 0.14, 0.14)
_GREEN = (0.16, 0.58, 0.26)
_SLATE = (0.16, 0.17, 0.20)


def _cg(rgb, a=0.94):
    return NSColor.colorWithCalibratedRed_green_blue_alpha_(rgb[0], rgb[1], rgb[2], a).CGColor()


class Overlay:
    def __init__(self):
        self.app = NSApplication.sharedApplication()
        # Accessory: no Dock icon, and — with the non-activating panel below —
        # showing the window never makes this process the active app.
        self.app.setActivationPolicy_(NSApplicationActivationPolicyAccessory)

        screen = NSScreen.mainScreen().frame()
        x = screen.origin.x + screen.size.width - _WIDTH - _MARGIN
        y = screen.origin.y + screen.size.height - _HEIGHT - _MARGIN
        rect = NSMakeRect(x, y, _WIDTH, _HEIGHT)

        panel = NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            rect,
            NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel,
            NSBackingStoreBuffered,
            False,
        )
        panel.setLevel_(NSStatusWindowLevel)          # above normal + floating windows
        panel.setOpaque_(False)
        panel.setBackgroundColor_(NSColor.clearColor())
        panel.setHasShadow_(True)
        panel.setIgnoresMouseEvents_(True)            # never eat clicks
        panel.setCollectionBehavior_(
            NSWindowCollectionBehaviorCanJoinAllSpaces
            | NSWindowCollectionBehaviorStationary
            | NSWindowCollectionBehaviorFullScreenAuxiliary
        )
        # Nonactivating panels can normally become key; forbid it so nothing we
        # do can pull focus. (Overriding via a subclass is heavier than needed;
        # we simply never call makeKey.)

        container = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, _WIDTH, _HEIGHT))
        container.setWantsLayer_(True)
        container.layer().setCornerRadius_(14.0)
        self._container = container

        label = NSTextField.alloc().initWithFrame_(NSMakeRect(18, 10, _WIDTH - 36, _HEIGHT - 20))
        label.setBezeled_(False)
        label.setDrawsBackground_(False)
        label.setEditable_(False)
        label.setSelectable_(False)
        label.setTextColor_(NSColor.whiteColor())
        label.setFont_(NSFont.boldSystemFontOfSize_(15.0))
        label.setMaximumNumberOfLines_(2)
        label.cell().setWraps_(True)
        container.addSubview_(label)
        self._label = label

        panel.setContentView_(container)
        self._panel = panel

    # -- run loop -----------------------------------------------------------
    def sleep(self, seconds):
        """Pump the run loop for `seconds` so the overlay paints/stays live —
        a drop-in replacement for time.sleep during driving."""
        NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(seconds))

    # -- display ------------------------------------------------------------
    def _show(self, text, accent):
        self._container.layer().setBackgroundColor_(_cg(accent))
        self._label.setStringValue_(text)
        self._panel.orderFrontRegardless()   # NOT makeKeyAndOrderFront — no focus steal
        self.sleep(0.05)

    def waiting(self, detail="activating and confirming frontmost…"):
        self._show(f"⏳  Waiting for Premiere Pro\n{detail}", _AMBER)

    def driving(self, detail="do not touch keyboard or mouse"):
        self._show(f"🔴  Driving Premiere Pro\n{detail}", _RED)

    def done(self, detail="you can use the desktop again"):
        self._show(f"✅  Done\n{detail}", _GREEN)

    def info(self, text):
        self._show(text, _SLATE)

    def notify(self, message, state="info"):
        """Show `message` with the accent for `state`
        ("waiting"/"driving"/"done"/"info") — no fixed prefix text, unlike
        `waiting`/`driving`/`done` above, which are tailored to the
        desktop-driving workflow specifically. Used by `notify_daemon` for
        arbitrary caller-supplied notifications."""
        accent = {"waiting": _AMBER, "driving": _RED, "done": _GREEN, "info": _SLATE}.get(state, _SLATE)
        self._show(message, accent)

    def hide(self):
        self._panel.orderOut_(None)
        self.sleep(0.02)
