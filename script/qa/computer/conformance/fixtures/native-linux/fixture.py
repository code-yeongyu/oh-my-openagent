#!/usr/bin/env python3
"""Conformance Fixture, Linux native (GTK 3 through PyGObject, exported to AT-SPI).

Usage: fixture.py --report <path>

Opens the window "Conformance Document" of the app "Conformance Fixture" and writes its state to <path> as JSON
(schema omo-conformance-fixture/1, see ../fixture-report.ts) after every change, by a write to a
temporary file and a rename, so a reader never sees a half-written report. The report is the only
oracle input; nothing in the UI under test is read back.

Prints "READY pid=<pid>" on stdout once the window is mapped. Reads control lines on stdin, a path
that needs no engine, used by the self-test (../self-test.ts):
  poke <action>        perform one catalog action's effect through the toolkit (click, ax.perform,
                       typeText, ax.setValue, keyChord, scroll, drag, menu.select)
  set <label> <text>   replace the text of the field <label>
  menu <A>/<B>         activate the menu item B of the menu A in the window "Conformance Document"
  quit                 close and exit
Each line is answered by "OK <line>" after the report is written, or "ERR <reason>".

CONFORMANCE_FIXTURE_SABOTAGE=<field> pins that report field to its initial value; the self-test's
sabotage leg uses it to prove the check can go red.
"""

import json
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
from document_window import APP, DocumentWindow  # noqa: E402
from gi.repository import GLib, Gtk  # noqa: E402
from poke import poke  # noqa: E402

SCHEMA = "omo-conformance-fixture/1"
SABOTAGE = os.environ.get("CONFORMANCE_FIXTURE_SABOTAGE", "")


class Fixture:
    def __init__(self, report_path):
        self.report_path = report_path
        self.windows = []
        self.initial = None
        self.open_window()
        self.initial = self.snapshot()
        self.write()

    def open_window(self):
        window = DocumentWindow(self, len(self.windows) + 1)
        self.windows.append(window)
        window.show_all()
        return window

    def changed(self):
        if self.initial is not None:
            self.write()

    def snapshot(self):
        main = self.windows[0]
        return {
            "schema": SCHEMA,
            "app": APP,
            "toolkit": "native",
            "windows": [window.get_title() for window in self.windows],
            "fields": {
                "value": main.text.text("Value"),
                "receivedKeys": ",".join(main.chords),
                "pressCount": main.press_count,
                "scrollSteps": main.scroll_steps,
                "dragOrder": ",".join(main.drag_list.order),
                "menuSelection": main.menu_selection,
            },
            "saved": dict(main.saved, savedDocuments=sum(1 for window in self.windows if window.saved_once)),
        }

    def write(self):
        report = self.snapshot()
        for section in ("fields", "saved"):
            if SABOTAGE in report[section]:
                report[section][SABOTAGE] = self.initial[section][SABOTAGE]
        temporary = f"{self.report_path}.tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(report, sort_keys=True, indent=2) + "\n")
        os.replace(temporary, self.report_path)


def control(fixture, line):
    words = line.split(" ", 2)
    main = fixture.windows[0]
    if words[0] == "quit":
        Gtk.main_quit()
        return None
    if words[0] == "poke" and len(words) == 2:
        poke(main, words[1])
    elif words[0] == "menu" and len(words) == 2:
        main.menu_items[words[1]].activate()
    elif words[0] == "set" and len(words) >= 2:
        label, _space, text = line[len("set ") :].partition(" ")
        main.text.set(label, text)
    else:
        raise ValueError(f"unknown control line {line!r}")
    fixture.write()
    return f"OK {line}"


def main():
    if len(sys.argv) != 3 or sys.argv[1] != "--report":
        print("usage: fixture.py --report <path>", file=sys.stderr)
        return 2
    fixture = Fixture(sys.argv[2])
    first = fixture.windows[0]

    def ready(_window, _event):
        print(f"READY pid={os.getpid()}", flush=True)
        return False

    first.connect("map-event", ready)

    def on_stdin(channel, condition):
        if condition & GLib.IO_HUP and not condition & GLib.IO_IN:
            Gtk.main_quit()
            return False
        line = channel.readline().rstrip("\n")
        if not line:
            return True
        try:
            answer = control(fixture, line)
        except (KeyError, ValueError) as error:
            answer = f"ERR {error}"
        if answer is not None:
            print(answer, flush=True)
        return answer is not None

    channel = GLib.IOChannel.unix_new(sys.stdin.fileno())
    GLib.io_add_watch(channel, GLib.PRIORITY_DEFAULT, GLib.IO_IN | GLib.IO_HUP, on_stdin)
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
