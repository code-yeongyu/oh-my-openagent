"""Screen geometry of the main window's widgets, for drivers that aim by pixel.

Each rect is keyed by the widget's accessible name with its role beside it; captions are never
emitted, so a lookup by name cannot land on the label next to a field. Rects are logical screen
points with the origin at the top-left of the virtual desktop. "hit" is the part of a widget that
answers a click where it differs from the widget's frame.
"""

TEXT_FIELDS = ("Value", "Title", "Name", "Email", "City", "New item")
DRAG_ROWS = ("a", "b")


def _rect(x, y, width, height):
    return {"x": int(x), "y": int(y), "width": int(width), "height": int(height)}


def _origin(window):
    origin = window.get_window().get_origin()
    return origin[-2], origin[-1]


def _screen(widget, window):
    coords = widget.translate_coordinates(window, 0, 0)
    if not coords:
        return None
    x, y = coords[-2], coords[-1]
    ox, oy = _origin(window)
    allocation = widget.get_allocation()
    return _rect(ox + x, oy + y, allocation.width, allocation.height)


def _checkbox_hit(button, window):
    frame = _screen(button, window)
    label = _screen(button.get_child(), window)
    if frame is None or label is None:
        return None
    return _rect(frame["x"], frame["y"], label["x"] + label["width"] - frame["x"], frame["height"])


def geometry(window):
    gdk_window = window.get_window()
    if gdk_window is None or not window.get_mapped():
        return None
    widgets = {}

    def put(name, role, widget, hit=None):
        rect = _screen(widget, window)
        if rect is None:
            return
        entry = {"role": role, "rect": rect}
        if hit is not None:
            entry["hit"] = hit
        widgets[name] = entry

    put("Press", "button", window.press)
    for label in TEXT_FIELDS:
        put(label, "text", window.text.widgets[label])
    put("Note", "text", window.text.widgets["Note"].get_parent())
    put("Archived", "checkbox", window.archived, _checkbox_hit(window.archived, window))
    put("Add", "button", window.buttons["Add"])
    put("Mark done", "button", window.buttons["Mark done"])
    put("Scroll target", "region", window.scroll_target)
    for row in window.drag_list.rows.get_children():
        if row.item in DRAG_ROWS:
            put(row.item, "list item", row, _screen(row, window))
    put("Test", "menubar item", window.menu_tops["Test"])
    ox, oy = _origin(window)
    frame = gdk_window.get_frame_extents()
    return {
        "space": "screen-logical",
        "scale": window.get_scale_factor(),
        "window": {
            "client": _rect(ox, oy, window.get_allocated_width(), window.get_allocated_height()),
            "frame": _rect(frame.x, frame.y, frame.width, frame.height),
        },
        "widgets": widgets,
    }
