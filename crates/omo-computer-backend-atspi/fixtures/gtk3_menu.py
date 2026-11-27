#!/usr/bin/env python3
# GTK3 fixture for the AT-SPI backend's live menu leg: File > Mark done changes the label.
# GTK 4.14 popover menu items carry no accessible name (their LABELLED_BY target is empty),
# so an exact-label menu selection is proven on GTK3, whose menu items are named.
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk  # noqa: E402

window = Gtk.Window(title="omo-atspi-menu-fixture")
window.connect("destroy", Gtk.main_quit)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
label = Gtk.Label(label="Idle")
bar = Gtk.MenuBar()
file_item = Gtk.MenuItem(label="File")
menu = Gtk.Menu()
for text in ("Mark done", "Mark done later"):
    item = Gtk.MenuItem(label=text)
    item.connect("activate", lambda widget: label.set_text("Menu: " + widget.get_label()))
    menu.append(item)
file_item.set_submenu(menu)
bar.append(file_item)
box.pack_start(bar, False, False, 0)
box.pack_start(label, False, False, 0)
window.add(box)
window.show_all()
Gtk.main()
