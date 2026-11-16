#!/usr/bin/env python3
"""A GTK3 fixture window: a solid background with single-pixel markers at logical
coordinates. GTK3 takes its window scale from GDK_SCALE (or the XSETTINGS window scale a
desktop sets beside Xft.dpi), not from Xft.dpi itself, so the xft-dpi-scale scenario starts it
with GDK_SCALE=2 and the window and its markers render at 2x in device pixels."""
import argparse

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gtk  # noqa: E402


def parse_colour(name):
    colour = Gdk.RGBA()
    if not colour.parse(name):
        raise SystemExit(f"not a colour: {name}")
    return colour.red, colour.green, colour.blue


def parse_marker(spec):
    at, _, colour = spec.partition("@")
    x, y = (int(part) for part in at.split(",", 1))
    return x, y, colour or "red"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", required=True)
    parser.add_argument("--width", type=int, default=100)
    parser.add_argument("--height", type=int, default=60)
    parser.add_argument("--background", default="white")
    parser.add_argument("--marker", action="append", default=[])
    args = parser.parse_args()

    background = parse_colour(args.background)
    markers = [(x, y, parse_colour(colour)) for x, y, colour in (parse_marker(m) for m in args.marker)]

    window = Gtk.Window(title=args.title)
    window.set_decorated(False)
    window.set_default_size(args.width, args.height)
    window.set_app_paintable(True)
    area = Gtk.DrawingArea()
    window.add(area)

    def draw(_area, cr):
        cr.set_source_rgb(*background)
        cr.paint()
        for x, y, colour in markers:
            cr.set_source_rgb(*colour)
            cr.rectangle(x, y, 1, 1)
            cr.fill()

    area.connect("draw", draw)
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
