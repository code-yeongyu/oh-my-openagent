import time

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk  # noqa: E402

UNDO_GROUP_SECONDS = 1.0


def named(widget, name):
    widget.get_accessible().set_name(name)
    return widget


def entry_text(widget):
    if isinstance(widget, Gtk.TextView):
        buffer = widget.get_buffer()
        return buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), False)
    return widget.get_text()


def set_entry_text(widget, text):
    if isinstance(widget, Gtk.TextView):
        widget.get_buffer().set_text(text)
    else:
        widget.set_text(text)


class TextFields:
    """The labelled text fields of one window and their undo history.

    Edits to one field less than UNDO_GROUP_SECONDS apart form one undo group, as a toolkit's typing
    coalescing does; Undo restores the newest group's field to its text before the group.
    """

    def __init__(self, on_change):
        self.on_change = on_change
        self.widgets = {}
        self.last_text = {}
        self.groups = []
        self.last_edit = (None, 0.0)
        self.restoring = False

    def track(self, label, widget):
        self.widgets[label] = widget
        self.last_text[label] = entry_text(widget)
        source = widget.get_buffer() if isinstance(widget, Gtk.TextView) else widget
        source.connect("changed", lambda _source: self.edited(label))

    def text(self, label):
        return entry_text(self.widgets[label])

    def set(self, label, text):
        set_entry_text(self.widgets[label], text)

    def edited(self, label):
        if not self.restoring:
            now = time.monotonic()
            previous_label, previous_at = self.last_edit
            if previous_label != label or now - previous_at > UNDO_GROUP_SECONDS:
                self.groups.append((label, self.last_text[label]))
            self.last_edit = (label, now)
        self.last_text[label] = self.text(label)
        self.on_change()

    def undo(self):
        if not self.groups:
            return
        label, text = self.groups.pop()
        self.last_edit = (None, 0.0)
        self.restoring = True
        try:
            self.set(label, text)
        finally:
            self.restoring = False
        self.on_change()
