//! The Wayland `Global` stop path over the GlobalShortcuts portal.

mod global_shortcuts;
mod trigger;

pub use global_shortcuts::{GlobalShortcutsListener, UNAVAILABLE};
pub use trigger::STOP_SHORTCUT_ID;

#[cfg(test)]
mod tests;
