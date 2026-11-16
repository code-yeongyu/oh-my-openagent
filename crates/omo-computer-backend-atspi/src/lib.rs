//! AT-SPI accessibility for the Linux backends: event-driven focus, the action-resolution
//! ladder, fail-closed frame ownership, secure classification, XDG app entries and menus, over
//! one bus connection per engine.
#![cfg(target_os = "linux")]

pub mod apps;
mod backend;
pub mod bus;
pub mod caps;
pub mod fake;
pub mod owner;
pub mod types;

pub use backend::{AtspiBackend, Observation};

#[cfg(test)]
mod tests;
