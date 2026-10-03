//! Held-state bookkeeping for `release_all`: every key-down and button-down
//! this backend posts is recorded with the route it was posted through, so the
//! matching release can be replayed on exactly that route.

use core_graphics::geometry::CGPoint;
use senpi_desktop_core::backend::MouseButton;

/// Where a key event was delivered.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum KeyRoute {
    /// `CGEventPost(kCGHIDEventTap)` - the global desktop path.
    Global,
    /// The SkyLight per-process keyboard route.
    Process(libc::pid_t),
}

/// Where a pointer button event was delivered.
#[derive(Clone, Copy, Debug)]
pub(super) enum ButtonRoute {
    /// `CGEventPost(kCGHIDEventTap)` at the recorded point.
    Global(CGPoint),
    /// The SkyLight per-window route, with the stamp's window-local point.
    Window(libc::pid_t, u32, CGPoint),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) struct HeldKey {
    pub(super) route: KeyRoute,
    pub(super) code: u16,
    /// The character a `type_text` key carries; a chord key has none.
    pub(super) text: Option<String>,
}

#[derive(Clone, Debug)]
pub(super) struct HeldButton {
    pub(super) route: ButtonRoute,
    pub(super) button: MouseButton,
}

#[derive(Default, Debug)]
pub(super) struct Held {
    keys: Vec<HeldKey>,
    buttons: Vec<HeldButton>,
}

impl Held {
    pub(super) fn key_down(&mut self, key: HeldKey) {
        self.keys.push(key);
    }

    pub(super) fn key_up(&mut self, route: KeyRoute, code: u16) {
        self.keys
            .retain(|held| !(held.route == route && held.code == code));
    }

    pub(super) fn button_down(&mut self, button: HeldButton) {
        self.buttons.push(button);
    }

    pub(super) fn button_up(&mut self, route: &ButtonRoute, button: MouseButton) {
        self.buttons
            .retain(|held| !(same_route(&held.route, route) && held.button == button));
    }

    pub(super) fn take_keys(&mut self) -> Vec<HeldKey> {
        std::mem::take(&mut self.keys)
    }

    pub(super) fn take_buttons(&mut self) -> Vec<HeldButton> {
        std::mem::take(&mut self.buttons)
    }

    #[cfg(test)]
    pub(super) fn is_empty(&self) -> bool {
        self.keys.is_empty() && self.buttons.is_empty()
    }
}

/// `CGPoint` carries no `PartialEq`, so routes compare field by field.
pub(super) fn same_route(a: &ButtonRoute, b: &ButtonRoute) -> bool {
    match (a, b) {
        (ButtonRoute::Global(p), ButtonRoute::Global(q)) => p.x == q.x && p.y == q.y,
        (ButtonRoute::Window(pid_a, wid_a, p), ButtonRoute::Window(pid_b, wid_b, q)) => {
            pid_a == pid_b && wid_a == wid_b && p.x == q.x && p.y == q.y
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn left() -> HeldButton {
        HeldButton {
            route: ButtonRoute::Global(CGPoint::new(10.0, 10.0)),
            button: MouseButton::Left,
        }
    }

    #[test]
    fn keys_released_on_the_matching_route_and_code_only() {
        let mut held = Held::default();
        held.key_down(HeldKey {
            route: KeyRoute::Global,
            code: 56,
            text: None,
        });
        held.key_down(HeldKey {
            route: KeyRoute::Process(42),
            code: 56,
            text: None,
        });
        held.key_down(HeldKey {
            route: KeyRoute::Process(42),
            code: 6,
            text: Some("z".into()),
        });
        held.key_up(KeyRoute::Process(42), 56);
        let drained = held.take_keys();
        assert_eq!(
            drained,
            vec![
                HeldKey {
                    route: KeyRoute::Global,
                    code: 56,
                    text: None
                },
                HeldKey {
                    route: KeyRoute::Process(42),
                    code: 6,
                    text: Some("z".into())
                },
            ]
        );
        assert!(held.is_empty());
    }

    #[test]
    fn buttons_release_by_route_and_kind() {
        let mut held = Held::default();
        held.button_down(left());
        held.button_down(HeldButton {
            route: ButtonRoute::Window(7, 9, CGPoint::new(10.0, 12.0)),
            button: MouseButton::Right,
        });
        held.button_up(
            &ButtonRoute::Window(7, 9, CGPoint::new(10.0, 12.0)),
            MouseButton::Left,
        );
        assert_eq!(held.take_buttons().len(), 2, "a left-up releases no right button");
        held.button_down(left());
        held.button_up(&ButtonRoute::Global(CGPoint::new(10.0, 10.0)), MouseButton::Left);
        assert!(held.is_empty());
    }

    #[test]
    fn failed_down_never_records_and_double_up_is_inert() {
        let mut held = Held::default();
        held.key_up(KeyRoute::Global, 55);
        held.button_up(&ButtonRoute::Global(CGPoint::new(0.0, 0.0)), MouseButton::Left);
        assert!(held.is_empty());
    }
}
