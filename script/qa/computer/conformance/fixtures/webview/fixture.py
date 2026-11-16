#!/usr/bin/env python3
"""Web-view host of the shared fixture page (../web): a GTK 3 window with a native menu bar around a
WebKitGTK 4.1 view. Usage: fixture.py --report <path>. Same report and stdin control protocol as
native-linux/fixture.py."""

import json
import os
import sys
from pathlib import Path

import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402

APP = "Conformance Fixture"
SCHEMA = "omo-conformance-fixture/1"
APP_KEY = "dev.omo.conformance-fixture.webview"
SABOTAGE = os.environ.get("CONFORMANCE_FIXTURE_SABOTAGE", "")
PAGE = (Path(__file__).resolve().parent.parent / "web" / "index.html").as_uri()
BRIDGE = "window.conformanceHost = { hideA11y: " + ("true" if SABOTAGE == "a11y" else "false") + ", post: (json) => window.webkit.messageHandlers.report.postMessage(json) }"
MENUS = (
    ("File", ("Save", "Rename…", "New Window")),
    ("Edit", ("Undo",)),
    ("Priority", ("Low", "Normal", "High")),
    ("Test", ("Conformance",)),
)


class Host:
    def __init__(self, report_path):
        self.report_path = report_path
        self.windows = []
        self.states = {}
        self.initial = None

    def open_window(self, on_loaded=None):
        number = len(self.windows) + 1
        window = Gtk.Window(title="Conformance Document" if number == 1 else f"Conformance Document {number}")
        window.set_default_size(640, 720)
        content = WebKit2.UserContentManager()
        content.add_script(
            WebKit2.UserScript(
                BRIDGE,
                WebKit2.UserContentInjectedFrames.TOP_FRAME,
                WebKit2.UserScriptInjectionTime.START,
                None,
                None,
            )
        )
        content.register_script_message_handler("report")
        content.connect("script-message-received::report", self.on_post, window)
        view = WebKit2.WebView(user_content_manager=content, is_ephemeral=True)  # no profile data on disk
        # Touch the ATK accessible now: the baseline run (43237342972) found only the menu bar in the tree,
        # and forcing the accessible early makes WebKit build the web-content subtree as soon as the
        # AT-SPI bridge (started by the workflow's dbus session) is reachable.
        view.get_accessible()
        window.view = view
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        box.pack_start(self.menu_bar(window), False, False, 0)
        box.pack_start(view, True, True, 0)
        window.add(box)
        window.connect("destroy", lambda _window: window is self.windows[0] and Gtk.main_quit())
        self.windows.append(window)
        if on_loaded is not None:
            view.connect("load-changed", lambda _view, event: event == WebKit2.LoadEvent.FINISHED and on_loaded())
        view.load_uri(PAGE)
        window.show_all()
        return window

    def menu_bar(self, window):
        bar = Gtk.MenuBar()
        for title, labels in MENUS:
            top = Gtk.MenuItem(label=title)
            submenu = Gtk.Menu()
            for label in labels:
                item = Gtk.MenuItem(label=label)
                item.connect("activate", lambda _item, path=f"{title}/{label}": self.menu(window, path, lambda: None))
                submenu.append(item)
            top.set_submenu(submenu)
            bar.append(top)
        return bar

    def on_post(self, _manager, result, window):
        self.states[window] = json.loads(result.get_js_value().to_string())
        self.write()

    def evaluate(self, window, script, done):
        def finished(view, task):
            value = view.run_javascript_finish(task).get_js_value()
            self.states[window] = json.loads(value.to_string())
            self.write()
            done()

        window.view.run_javascript(f"JSON.stringify({script})", None, finished)

    def menu(self, window, path, done):
        if path == "File/New Window":

            def loaded():
                self.write()
                done()

            self.open_window(loaded)
            return
        self.evaluate(window, f"conformance.menu({json.dumps(path)})", done)

    def write(self):
        if not self.windows or self.windows[0] not in self.states:
            return
        main = self.states[self.windows[0]]
        saved_documents = sum(1 for window in self.windows if self.states.get(window, {}).get("savedOnce"))
        report = {
            "schema": SCHEMA,
            "app": APP,
            "toolkit": "webview",
            "windows": [window.get_title() for window in self.windows],
            "appKey": Gdk.get_program_class(),
            "fields": dict(main["fields"]),
            "saved": dict(main["saved"], savedDocuments=saved_documents),
        }
        if self.initial is None:
            self.initial = json.loads(json.dumps(report))
        for section in ("fields", "saved"):
            if SABOTAGE in report[section]:
                report[section][SABOTAGE] = self.initial[section][SABOTAGE]
        temporary = f"{self.report_path}.tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(report, sort_keys=True, indent=2) + "\n")
        os.replace(temporary, self.report_path)

    def control(self, line, answer):
        verb, _space, rest = line.partition(" ")
        main = self.windows[0]

        def done():
            answer(f"OK {line}")

        if verb == "poke":
            self.evaluate(main, f"conformance.poke({json.dumps(rest)})", done)
        elif verb == "menu":
            self.menu(main, rest, done)
        elif verb == "set":
            label, _space, text = rest.partition(" ")
            self.evaluate(main, f"conformance.set({json.dumps(label)}, {json.dumps(text)})", done)
        else:
            answer(f"ERR unknown control line {line!r}")


def main():
    if len(sys.argv) != 3 or sys.argv[1] != "--report":
        print("usage: fixture.py --report <path>", file=sys.stderr)
        return 2
    # Never inherit an atk-bridge disable; the a11y leg of the self-test needs the ATK tree.
    os.environ.pop("NO_AT_BRIDGE", None)
    GLib.set_prgname(APP_KEY)
    Gdk.set_program_class(APP_KEY)
    host = Host(sys.argv[2])

    def say(text):
        print(text, flush=True)

    def on_stdin(channel, condition):
        if condition & GLib.IO_HUP and not condition & GLib.IO_IN:
            Gtk.main_quit()
            return False
        line = channel.readline().rstrip("\n")
        if line == "quit":
            Gtk.main_quit()
            return False
        if line:
            try:
                host.control(line, say)
            except GLib.Error as error:
                say(f"ERR {error.message}")
        return True

    def ready():
        host.evaluate(host.windows[0], "conformance.state()", lambda: say(f"READY pid={os.getpid()}"))
        channel = GLib.IOChannel.unix_new(sys.stdin.fileno())
        GLib.io_add_watch(channel, GLib.PRIORITY_DEFAULT, GLib.IO_IN | GLib.IO_HUP, on_stdin)

    host.open_window(ready)
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
