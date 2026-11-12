import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, Gtk  # noqa: E402
from text_fields import named  # noqa: E402

DRAG_ITEMS = ("a", "b", "c")


class DragList(Gtk.EventBox):
    """A list of the rows a, b, c reordered by a pointer drag: press on a row, release over another.

    Releasing over the upper half of the target row puts the dragged row before it, the lower half
    after it. The event box sits above the list so it receives the press and the release itself.
    """

    def __init__(self, on_change):
        super().__init__()
        self.on_change = on_change
        self.order = list(DRAG_ITEMS)
        self.source = None
        self.rows = named(Gtk.ListBox(), "Order")
        self.set_above_child(True)
        self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK)
        self.connect("button-press-event", self.on_press)
        self.connect("button-release-event", self.on_release)
        self.add(self.rows)
        self.render()

    def row_at(self, event):
        _ok, _x, y = self.translate_coordinates(self.rows, int(event.x), int(event.y))
        return self.rows.get_row_at_y(y), y

    def on_press(self, _box, event):
        if event.button == 1:
            row, _y = self.row_at(event)
            self.source = None if row is None else row.item
        return True

    def on_release(self, _box, event):
        source, self.source = self.source, None
        if event.button != 1 or source is None:
            return True
        target, y = self.row_at(event)
        if target is None or target.item == source:
            return True
        allocation = target.get_allocation()
        order = [item for item in self.order if item != source]
        index = order.index(target.item)
        if y >= allocation.y + allocation.height / 2:
            index += 1
        order.insert(index, source)
        self.order = order
        self.render()
        self.on_change()
        return True

    def row_y(self, item):
        for row in self.rows.get_children():
            if row.item == item:
                return row.get_allocation().y
        raise KeyError(item)

    def render(self):
        for child in self.rows.get_children():
            self.rows.remove(child)
        for item in self.order:
            row = named(Gtk.ListBoxRow(), item)
            row.add(Gtk.Label(label=item, xalign=0))
            row.item = item
            self.rows.add(row)
        self.rows.show_all()
