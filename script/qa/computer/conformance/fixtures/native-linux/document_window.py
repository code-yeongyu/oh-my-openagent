import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
from drag_list import DragList  # noqa: E402
from gi.repository import Gdk, Gtk  # noqa: E402
from text_fields import TextFields, named  # noqa: E402

APP = "Conformance Fixture"
LONG_ROWS = 60
CHORD_MASKS = (
    (Gdk.ModifierType.CONTROL_MASK, "ctrl"),
    (Gdk.ModifierType.MOD1_MASK, "alt"),
    (Gdk.ModifierType.SHIFT_MASK, "shift"),
    (Gdk.ModifierType.SUPER_MASK, "super"),
)
CHORD_REQUIRES = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.MOD1_MASK | Gdk.ModifierType.SUPER_MASK


class DocumentWindow(Gtk.Window):
    def __init__(self, fixture, number):
        super().__init__(title="Conformance Document" if number == 1 else f"Conformance Document {number}")
        self.fixture = fixture
        self.set_wmclass("conformance-fixture", APP)
        self.set_default_size(640, 720)
        self.press_count = 0
        self.scroll_steps = 0
        self.chords = []
        self.menu_selection = ""
        self.document_name = "Document"
        self.items = []
        self.priority = ""
        self.done_row = 0
        self.saved_once = False
        self.menu_items = {}
        self.text = TextFields(fixture.changed)
        self.connect("key-press-event", self.on_key)
        self.connect("delete-event", self.on_delete)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.add(outer)
        outer.pack_start(self.build_menu_bar(), False, False, 0)
        body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, margin=8)
        outer.pack_start(body, True, True, 0)
        self.press = self.add_button(body, "Press", self.on_press)
        for label in ("Value", "Title", "Name", "Email", "City"):
            self.add_field(body, label)
        self.archived = named(Gtk.CheckButton(label="Archived"), "Archived")
        self.archived.connect("toggled", lambda _button: self.fixture.changed())
        body.pack_start(self.archived, False, False, 0)
        self.add_note(body)
        items = Gtk.Box(spacing=6)
        self.add_field(items, "New item")
        self.add_button(items, "Add", self.on_add_item)
        body.pack_start(items, False, False, 0)
        self.scroll_target = self.add_scroll_target(body)
        self.drag_list = DragList(fixture.changed)
        body.pack_start(self.drag_list, False, False, 0)
        self.long_list = self.add_long_list(body)
        self.add_button(body, "Mark done", self.on_mark_done)
        self.saved = self.document_state()

    def add_button(self, box, label, handler):
        button = named(Gtk.Button(label=label), label)
        button.connect("clicked", lambda _button: handler())
        box.pack_start(button, False, False, 0)
        return button

    def add_field(self, box, label):
        row = Gtk.Box(spacing=6)
        caption = Gtk.Label(label=label, xalign=0)
        caption.set_size_request(80, -1)
        entry = named(Gtk.Entry(), label)
        caption.set_mnemonic_widget(entry)
        row.pack_start(caption, False, False, 0)
        row.pack_start(entry, True, True, 0)
        box.pack_start(row, True, True, 0)
        self.text.track(label, entry)

    def add_note(self, box):
        frame = Gtk.ScrolledWindow()
        frame.set_size_request(-1, 60)
        note = named(Gtk.TextView(), "Note")
        frame.add(note)
        box.pack_start(Gtk.Label(label="Note", xalign=0), False, False, 0)
        box.pack_start(frame, False, False, 0)
        self.text.track("Note", note)

    def add_scroll_target(self, box):
        target = named(Gtk.EventBox(), "Scroll target")
        target.add_events(Gdk.EventMask.SCROLL_MASK)
        target.connect("scroll-event", self.on_scroll)
        target.add(Gtk.Label(label="Scroll target"))
        target.set_size_request(-1, 40)
        box.pack_start(target, False, False, 0)
        return target

    def add_long_list(self, box):
        scroller = Gtk.ScrolledWindow()
        scroller.set_size_request(-1, 160)
        rows = named(Gtk.ListBox(), "Rows")
        for number in range(1, LONG_ROWS + 1):
            row = named(Gtk.ListBoxRow(), f"Row {number}")
            row.add(Gtk.Label(label=f"Row {number}", xalign=0))
            row.number = number
            rows.add(row)
        scroller.add(rows)
        box.pack_start(scroller, True, True, 0)
        return rows

    def build_menu_bar(self):
        bar = Gtk.MenuBar()
        menus = (
            ("File", (("Save", self.on_save), ("Rename…", self.on_rename), ("New Window", self.on_new_window))),
            ("Edit", (("Undo", self.text.undo),)),
            ("Priority", tuple((name, self.setter("priority", name)) for name in ("Low", "Normal", "High"))),
            ("Test", (("Conformance", self.setter("menu_selection", "Conformance")),)),
        )
        for title, entries in menus:
            top = Gtk.MenuItem(label=title)
            submenu = Gtk.Menu()
            for label, handler in entries:
                item = Gtk.MenuItem(label=label)
                item.connect("activate", lambda _item, handler=handler: handler())
                submenu.append(item)
                self.menu_items[f"{title}/{label}"] = item
            top.set_submenu(submenu)
            bar.append(top)
        return bar

    def document_state(self):
        return {
            "title": self.text.text("Title"),
            "name": self.text.text("Name"),
            "email": self.text.text("Email"),
            "city": self.text.text("City"),
            "archived": self.archived.get_active(),
            "priority": self.priority,
            "order": ",".join(self.drag_list.order),
            "doneRow": self.done_row,
            "note": self.text.text("Note"),
            "documentName": self.document_name,
            "items": ",".join(self.items),
        }

    def setter(self, attribute, value):
        def assign():
            setattr(self, attribute, value)
            self.fixture.changed()

        return assign

    def on_press(self):
        self.press_count += 1
        self.fixture.changed()

    def on_key(self, _window, event):
        state = event.state & Gtk.accelerator_get_default_mod_mask()
        if state & CHORD_REQUIRES and not event.is_modifier:
            parts = [name for mask, name in CHORD_MASKS if state & mask]
            key = Gdk.keyval_name(Gdk.keyval_to_lower(event.keyval)) or str(event.keyval)
            self.chords.append("+".join([*parts, key.lower()]))
            self.fixture.changed()
        return False

    def on_scroll(self, _target, event):
        steps = {Gdk.ScrollDirection.DOWN: 1, Gdk.ScrollDirection.UP: -1}.get(event.direction)
        if steps is None:
            return False
        self.scroll_steps += steps
        self.fixture.changed()
        return True

    def on_add_item(self):
        if self.text.text("New item"):
            self.items.append(self.text.text("New item"))
            self.text.set("New item", "")
        self.fixture.changed()

    def on_mark_done(self):
        row = self.long_list.get_selected_row()
        if row is not None:
            self.done_row = row.number
            self.fixture.changed()

    def on_save(self):
        self.saved = self.document_state()
        self.saved_once = True
        self.fixture.changed()

    def on_new_window(self):
        self.fixture.open_window()
        self.fixture.changed()

    def on_rename(self):
        dialog = Gtk.Dialog(title="Rename", transient_for=self, modal=True)
        entry = named(Gtk.Entry(), "New name")
        button = named(Gtk.Button(label="Rename"), "Rename")
        dialog.get_content_area().pack_start(entry, False, False, 6)
        dialog.get_content_area().pack_start(button, False, False, 6)

        def rename(_button):
            if entry.get_text():
                self.document_name = entry.get_text()
            dialog.destroy()
            self.fixture.changed()

        button.connect("clicked", rename)
        dialog.show_all()

    def on_delete(self, _window, _event):
        if self is self.fixture.windows[0]:
            Gtk.main_quit()
        return False
