import pytest

desktop_driver = pytest.importorskip(
    "premiere_cli.desktop_driver",
    reason="desktop_driver imports pyobjc (Cocoa/ApplicationServices/Quartz), macOS only",
)


def test_navigation_steps_same_index_needs_no_movement():
    reset, key, steps = desktop_driver._navigation_steps(
        ["None", "[Custom]", "Browse...", "Foo"], "Browse...", "Browse..."
    )
    assert (reset, key, steps) == (False, desktop_driver.KEY_DOWN, 0)


def test_navigation_steps_forward_presses_down():
    reset, key, steps = desktop_driver._navigation_steps(
        ["None", "[Custom]", "Browse...", "Foo"], "None", "Browse..."
    )
    assert (reset, key, steps) == (False, desktop_driver.KEY_DOWN, 2)


def test_navigation_steps_backward_presses_up():
    reset, key, steps = desktop_driver._navigation_steps(
        ["None", "[Custom]", "Browse...", "Foo"], "Foo", "Browse..."
    )
    assert (reset, key, steps) == (False, desktop_driver.KEY_UP, 1)


def test_navigation_steps_current_not_in_labels_resets_to_top():
    # Premiere renames the "[Custom]" slot to whichever LUT is currently
    # applied, so a prior value can vanish from the next lookup entirely.
    reset, key, steps = desktop_driver._navigation_steps(
        ["None", "[Custom]", "Browse...", "Foo"], "some_previously_applied_lut", "Browse..."
    )
    assert (reset, key, steps) == (True, desktop_driver.KEY_DOWN, 2)


def test_navigation_steps_raises_if_target_missing():
    with pytest.raises(ValueError):
        desktop_driver._navigation_steps(["None", "[Custom]"], "None", "Browse...")
