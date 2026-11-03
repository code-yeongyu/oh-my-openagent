//! Held-state bookkeeping for `release_all`: every key and button this
//! backend pressed and has not released yet, with the route it went through,
//! so the release is replayed on exactly that route.

use x11rb::protocol::xproto::Window;

use super::server::Spot;

/// How an event was delivered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// XTEST: real input to whatever is under the pointer / focused.
    Xtest,
    /// `XSendEvent` to one window.
    Window(Window),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeldKey {
    pub route: Route,
    pub code: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeldButton {
    pub route: Route,
    pub detail: u8,
    /// Where it went down; a synthetic release is sent to the same spot.
    pub at: Spot,
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
        self.button_up(button.route, button.detail);
        self.buttons.push(button);
    }

    pub fn button_up(&mut self, route: Route, detail: u8) {
        self.buttons
            .retain(|held| !(held.route == route && held.detail == detail));
    }

    /// Held keys, most recently pressed first (release order).
    pub fn keys(&self) -> Vec<HeldKey> {
        self.keys.iter().rev().copied().collect()
    }

    pub fn buttons(&self) -> Vec<HeldButton> {
        self.buttons.iter().rev().copied().collect()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty() && self.buttons.is_empty()
    }
}
