//! AT-SPI accessibility for the Linux backends: event-driven focus, the action-resolution
//! ladder, fail-closed frame ownership, secure classification, XDG app entries and menus, over
//! one bus connection per engine.
#![cfg(target_os = "linux")]

pub mod apps;
mod backend;
pub mod bus;
pub mod caps;
pub mod fake;
pub mod live;
mod menus;
mod notify;
pub mod owner;
mod roles;
mod secure;
mod settle;
pub mod types;

pub use backend::{AtspiBackend, Observation, EVENTS};
pub use live::LiveBus;

#[cfg(test)]
mod tests;
