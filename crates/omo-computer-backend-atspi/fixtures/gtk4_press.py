#!/usr/bin/env python3
# GTK4 fixture for the AT-SPI backend's live press leg: a button whose press changes a label.
# Started by the tests under dbus-run-session + Xvfb; it never touches the host display.
import gi

gi.require_version("Gtk", "4.0")
from gi.repository import Gio, Gtk  # noqa: E402


class Fixture(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="dev.omo.AtspiFixture", flags=Gio.ApplicationFlags.NON_UNIQUE)
        self.presses = 0

    def do_activate(self):
        window = Gtk.ApplicationWindow(application=self, title="omo-atspi-fixture")
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        label = Gtk.Label(label="Idle")
        button = Gtk.Button(label="Press me")

        def pressed(_):
            self.presses += 1
            label.set_label(f"Pressed {self.presses}")

        button.connect("clicked", pressed)
        box.append(button)
        box.append(label)
        window.set_child(box)
        window.present()


Fixture().run([])
