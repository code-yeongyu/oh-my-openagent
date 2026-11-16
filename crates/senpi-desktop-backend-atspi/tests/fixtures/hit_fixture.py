#!/usr/bin/env python3
"""GTK3 hit-test fixture for the AT-SPI hit-test live test.

Usage: hit_fixture.py <title>

Opens one window titled <title> whose content nests a Press button and a
text field named Value inside two boxes, the way a real app nests controls
under the frame's root filler. Prints READY once the window is drawn.
"""

import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402

title = sys.argv[1]

window = Gtk.Window(title=title)
window.set_default_size(480, 320)
outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, border_width=24)
row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
press = Gtk.Button(label="Press")
row.pack_start(press, False, False, 0)
outer.pack_start(row, False, False, 0)
value = Gtk.Entry()
value.get_accessible().set_name("Value")
outer.pack_start(value, False, False, 0)
window.add(outer)
window.connect("destroy", Gtk.main_quit)


def ready(*_args):
    GLib.idle_add(lambda: print("READY", flush=True) and False)
    return False


window.connect("map-event", ready)
window.show_all()
Gtk.main()
