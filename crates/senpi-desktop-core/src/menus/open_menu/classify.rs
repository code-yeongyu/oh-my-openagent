//! Which presses can open a menu, and how long the menu they open may take to
//! appear.

use std::time::Duration;

use super::{CONTEXT_MENU_TIMEOUT, CONTROL_MENU_TIMEOUT};
use crate::backend::{MouseButton, PointerEvent};

/// Whether `event` is a secondary press, which opens a context menu in most
/// views: a right press, or a left press with Control held.
pub const fn may_open_context_menu(event: &PointerEvent) -> bool {
    let (button, control) = match event {
        PointerEvent::Click {
            button, modifiers, ..
        }
        | PointerEvent::Drag {
            button, modifiers, ..
        } => (*button, modifiers.ctrl),
        PointerEvent::Move { .. } | PointerEvent::Scroll { .. } => return false,
    };
    matches!(button, MouseButton::Right) || (matches!(button, MouseButton::Left) && control)
}

/// Whether a control of (native) `role` opens a menu when pressed.
pub fn opens_menu(role: Option<&str>) -> bool {
    matches!(role, Some("AXMenuButton" | "AXPopUpButton"))
}

/// Whether `action`, as the model names it (`press`, `showMenu`, `AXPress`),
/// can open a menu on an element: `AXShowMenu` on any element, `AXPress` on a
/// menu button or popup button. `role` is read only for a press, so other
/// actions pay nothing for the check.
pub fn may_open(action: &str, role: impl FnOnce() -> Option<String>) -> bool {
    match action.trim().to_ascii_lowercase().as_str() {
        "axshowmenu" | "showmenu" | "show_menu" => true,
        "axpress" | "press" => opens_menu(role().as_deref()),
        _ => false,
    }
}

/// How long a press with a path to choose waits for its menu: a secondary
/// press opens a context menu, any other press a control's menu.
pub const fn watch_timeout(event: &PointerEvent) -> Duration {
    if may_open_context_menu(event) {
        CONTEXT_MENU_TIMEOUT
    } else {
        CONTROL_MENU_TIMEOUT
    }
}

/// How long `event` waits for a menu it may open, or `None` when none is
/// watched for: in an application behind the user's (`background`), a
/// secondary press may open a context menu, and a left press on a menu button
/// or popup button (`on_menu_control`) opens its menu; any press with a
/// `menu` path waits for its menu wherever it opens. A frontmost
/// application's menu stays open for the next call, as the user's would.
/// Nothing is refused for being menu-shaped (D1): a multi-click, a drag or a
/// hold on a menu control is delivered as the one press that opens the menu.
pub fn menu_watch(
    event: &PointerEvent,
    background: bool,
    menu: bool,
    on_menu_control: impl FnOnce() -> bool,
) -> Option<Duration> {
    if may_open_context_menu(event) {
        return (background || menu).then_some(CONTEXT_MENU_TIMEOUT);
    }
    if menu {
        return Some(CONTROL_MENU_TIMEOUT);
    }
    (background && on_menu_control()).then_some(CONTROL_MENU_TIMEOUT)
}

#[cfg(test)]
mod tests {
    use super::{may_open, may_open_context_menu, menu_watch, watch_timeout};
    use crate::backend::{Modifiers, MouseButton, PointerEvent};
    use crate::menus::open_menu::{CONTEXT_MENU_TIMEOUT, CONTROL_MENU_TIMEOUT};

    fn click(button: MouseButton, ctrl: bool) -> PointerEvent {
        PointerEvent::Click {
            x: 1.0,
            y: 1.0,
            button,
            count: 1,
            modifiers: Modifiers {
                ctrl,
                ..Modifiers::default()
            },
        }
    }

    #[test]
    fn a_secondary_press_may_open_a_context_menu() {
        assert!(may_open_context_menu(&click(MouseButton::Right, false)));
        assert!(may_open_context_menu(&click(MouseButton::Left, true)));
        assert!(!may_open_context_menu(&click(MouseButton::Left, false)));
        assert!(!may_open_context_menu(&click(MouseButton::Middle, true)));
        assert!(!may_open_context_menu(&PointerEvent::Move {
            x: 1.0,
            y: 1.0
        }));
        assert_eq!(
            watch_timeout(&click(MouseButton::Right, false)),
            CONTEXT_MENU_TIMEOUT
        );
        assert_eq!(
            watch_timeout(&click(MouseButton::Left, false)),
            CONTROL_MENU_TIMEOUT
        );
    }

    #[test]
    fn a_background_secondary_press_or_menu_control_press_is_watched_even_without_a_path() {
        let unread = || -> bool { panic!("a secondary press pays no hit-test") };
        assert_eq!(
            menu_watch(&click(MouseButton::Right, false), true, false, unread),
            Some(CONTEXT_MENU_TIMEOUT)
        );
        assert_eq!(
            menu_watch(&click(MouseButton::Right, false), false, false, unread),
            None
        );
        assert_eq!(
            menu_watch(&click(MouseButton::Right, false), false, true, unread),
            Some(CONTEXT_MENU_TIMEOUT)
        );
        assert_eq!(
            menu_watch(&click(MouseButton::Left, false), true, false, || true),
            Some(CONTROL_MENU_TIMEOUT)
        );
        assert_eq!(
            menu_watch(&click(MouseButton::Left, false), true, false, || false),
            None
        );
        // The frontmost app's menu stays open for the next call, as the user's would.
        let front = || -> bool { panic!("a frontmost press pays no hit-test") };
        assert_eq!(
            menu_watch(&click(MouseButton::Left, false), false, false, front),
            None
        );
        assert_eq!(
            menu_watch(&click(MouseButton::Left, false), false, true, front),
            Some(CONTROL_MENU_TIMEOUT)
        );
    }

    #[test]
    fn only_menu_opening_actions_watch_for_a_menu() {
        let unread = || -> Option<String> { panic!("the role is read only for a press") };
        assert!(may_open("AXShowMenu", unread));
        assert!(may_open("showMenu", unread));
        assert!(!may_open("AXIncrement", unread));
        assert!(!may_open("AXConfirm", unread));
        assert!(may_open("press", || Some("AXMenuButton".to_string())));
        assert!(may_open("AXPress", || Some("AXPopUpButton".to_string())));
        assert!(!may_open("AXPress", || Some("AXButton".to_string())));
        assert!(!may_open("press", || None));
    }
}
