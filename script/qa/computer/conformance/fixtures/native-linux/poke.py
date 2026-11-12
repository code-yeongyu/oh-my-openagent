import gi

gi.require_version("Gdk", "3.0")
from gi.repository import Gdk  # noqa: E402


def synthetic(kind, window):
    event = Gdk.Event.new(kind)
    seat = Gdk.Display.get_default().get_default_seat()
    event.set_device(seat.get_keyboard() if kind == Gdk.EventType.KEY_PRESS else seat.get_pointer())
    detail = {Gdk.EventType.KEY_PRESS: event.key, Gdk.EventType.SCROLL: event.scroll}.get(kind, event.button)
    detail.window = window
    detail.send_event = 1
    return event, detail


def press_chord(window):
    event, key = synthetic(Gdk.EventType.KEY_PRESS, window.get_window())
    key.keyval = Gdk.KEY_k
    key.state = Gdk.ModifierType.CONTROL_MASK
    window.event(event)


def scroll_down(target, clicks):
    for _ in range(clicks):
        event, scroll = synthetic(Gdk.EventType.SCROLL, target.get_window())
        scroll.direction = Gdk.ScrollDirection.DOWN
        target.event(event)


def drag(drag_list, source, target):
    origin = drag_list.get_allocation()
    offset = (0, 0) if drag_list.get_has_window() else (origin.x, origin.y)
    for kind, item, dy in ((Gdk.EventType.BUTTON_PRESS, source, 4), (Gdk.EventType.BUTTON_RELEASE, target, 1)):
        event, button = synthetic(kind, drag_list.get_window())
        _ok, x, y = drag_list.rows.translate_coordinates(drag_list, 4, drag_list.row_y(item) + dy)
        button.button = 1
        button.x = float(x + offset[0])
        button.y = float(y + offset[1])
        drag_list.event(event)


def poke(window, action):
    """Perform one catalog action's effect on its widget through GTK itself, never through the engine."""
    match action:
        case "click" | "ax.perform":
            window.press.clicked()
        case "typeText":
            window.text.widgets["Value"].insert_text("conformance", -1)
        case "ax.setValue":
            window.text.set("Value", "conformance")
        case "keyChord":
            press_chord(window)
        case "scroll":
            scroll_down(window.scroll_target, 3)
        case "drag":
            drag(window.drag_list, "b", "a")
        case "menu.select":
            window.menu_items["Test/Conformance"].activate()
        case _:
            raise ValueError(f"unknown action {action}")
