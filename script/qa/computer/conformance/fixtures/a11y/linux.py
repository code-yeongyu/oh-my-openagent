#!/usr/bin/env python3
"""AT-SPI probe for the a11y leg of the fixture self-test: linux.py <pid> <window title>.

Walks the AT-SPI tree, finds the fixture window by title and requires the page's controls to be
visible: at least one named push button and one named text entry beneath it. Renderer
accessibility must already be forced on by the host (Electron switch / WebKitGTK ATK accessible).

Prints "A11Y buttons=<n> entries=<m>" and exits 0 when both are visible, 1 when a control class is
missing (the fixture hides its controls from accessibility), 3 (ENVIRONMENT) when AT-SPI itself is
unreachable - no bus, no desktop or no window with that title within the wait."""

import sys
import time

try:
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi  # noqa: E402
except Exception as error:  # the Atspi typelib missing on the runner is the runner, not the fixture
    print(f"ENVIRONMENT: the Atspi typelib is unavailable ({error})")
    sys.exit(3)

WAIT_SECONDS = 20.0
MAX_DEPTH = 40
WINDOW_ROLES = (Atspi.Role.FRAME, Atspi.Role.WINDOW)


def descendants(element, depth=0):
    if depth > MAX_DEPTH:
        return
    for index in range(element.get_child_count()):
        child = element.get_child_at_index(index)
        if child is not None:
            yield child
            yield from descendants(child, depth + 1)


def count_controls(root):
    buttons = entries = 0
    for element in descendants(root):
        try:
            if element.get_role() == Atspi.Role.PUSH_BUTTON and element.get_name():
                buttons += 1
            elif element.get_role() == Atspi.Role.ENTRY and element.get_name():
                entries += 1
        except Exception:
            continue
    return buttons, entries


def find_window(title):
    desktop = Atspi.get_desktop()
    if desktop is None:
        return None
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if app is None:
            continue
        for element in descendants(app):
            try:
                if element.get_name() == title and element.get_role() in WINDOW_ROLES:
                    return element
            except Exception:
                continue
    return None


def main():
    if len(sys.argv) != 3:
        print("usage: linux.py <pid> <window title>", file=sys.stderr)
        return 2
    title = sys.argv[2]
    deadline = time.monotonic() + WAIT_SECONDS
    window = None
    while window is None:
        try:
            window = find_window(title)
        except Exception as error:  # no AT-SPI bus on this runner
            print(f"ENVIRONMENT: AT-SPI unreachable ({error})")
            return 3
        if window is None and time.monotonic() >= deadline:
            print(f"ENVIRONMENT: no AT-SPI window titled {title!r} within {WAIT_SECONDS:.0f}s")
            return 3
        if window is None:
            time.sleep(0.5)
    # The tree can appear a moment after the window; give the controls the same wait.
    deadline = time.monotonic() + WAIT_SECONDS
    buttons, entries = count_controls(window)
    while (buttons < 1 or entries < 1) and time.monotonic() < deadline:
        time.sleep(0.5)
        buttons, entries = count_controls(window)
    print(f"A11Y buttons={buttons} entries={entries}")
    return 0 if buttons >= 1 and entries >= 1 else 1


if __name__ == "__main__":
    sys.exit(main())
