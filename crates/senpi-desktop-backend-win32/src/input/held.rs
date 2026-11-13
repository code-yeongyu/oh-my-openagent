//! Held-state bookkeeping for `release_all`: every key and button this
//! backend pressed and has not released yet, with the route it went down
//! on, so the release is replayed on exactly that route.

use senpi_desktop_core::backend::MouseButton;

/// How a press was delivered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// The system input queue (`SendInput` or enigo): released with
    /// `SendInput`.
    System,
    /// Posted to one window (the HWND value): released with `PostMessageW`.
    Window(usize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeldKey {
    pub route: Route,
    pub vk: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeldButton {
    pub route: Route,
    pub button: MouseButton,
    /// The client point `lParam` it went down at; a posted release goes to
    /// the same point.
    pub at: isize,
}

#[derive(Debug, Default)]
pub struct Held {
    keys: Vec<HeldKey>,
    buttons: Vec<HeldButton>,
}

impl Held {
    pub fn key_down(&mut self, key: HeldKey) {
        if !self.keys.contains(&key) {
            self.keys.push(key);
        }
    }

    pub fn key_up(&mut self, key: HeldKey) {
        self.keys.retain(|held| *held != key);
    }

    pub fn button_down(&mut self, button: HeldButton) {
        self.button_up(button.route, button.button);
        self.buttons.push(button);
    }

    pub fn button_up(&mut self, route: Route, button: MouseButton) {
        self.buttons
            .retain(|held| !(held.route == route && held.button == button));
    }

    /// Held keys, most recently pressed first (release order).
    pub fn keys(&self) -> Vec<HeldKey> {
        self.keys.iter().rev().copied().collect()
    }

    /// Held buttons, most recently pressed first.
    pub fn buttons(&self) -> Vec<HeldButton> {
        self.buttons.iter().rev().copied().collect()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty() && self.buttons.is_empty()
    }
}
