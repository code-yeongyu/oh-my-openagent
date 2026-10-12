#!/usr/bin/env python3
"""GTK3 menu fixture for the AT-SPI menu live tests.

Usage: menu_fixture.py <title>

Opens one window titled <title> with a menu bar:
File > Open..., Save (Ctrl+S), Print, print, Recent > a.txt; Edit > Undo (insensitive).
Prints READY once the window is shown, then one "<label>@<title>" line per
activated item, submenu items included, on stdout.
"""

import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402

title = sys.argv[1]


def report(line):
    print(line, flush=True)


def recorder(label):
    return lambda _item: report(f"{label}@{title}")


def command(label, accel_group=None, accel=None, sensitive=True):
    item = Gtk.MenuItem(label=label)
    item.connect("activate", recorder(label))
    item.set_sensitive(sensitive)
    if accel_group is not None and accel is not None:
        key, mods = Gtk.accelerator_parse(accel)
        item.add_accelerator("activate", accel_group, key, mods, Gtk.AccelFlags.VISIBLE)
    return item


def submenu(label, items):
    top = command(label)
    menu = Gtk.Menu()
    for child in items:
        menu.append(child)
    top.set_submenu(menu)
    return top


window = Gtk.Window(title=title)
window.set_default_size(480, 320)
accels = Gtk.AccelGroup()
window.add_accel_group(accels)
bar = Gtk.MenuBar()
bar.append(
    submenu(
        "File",
        [
            command("Open..."),
            Gtk.SeparatorMenuItem(),
            command("Save", accels, "<Primary>s"),
            command("Print"),
            command("print"),
            submenu("Recent", [command("a.txt")]),
        ],
    )
)
bar.append(submenu("Edit", [command("Undo", sensitive=False)]))
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
box.pack_start(bar, False, False, 0)
box.pack_start(Gtk.Label(label="menu fixture"), True, True, 0)
window.add(box)
window.connect("destroy", Gtk.main_quit)
window.show_all()
GLib.idle_add(lambda: report("READY") and False)
Gtk.main()
