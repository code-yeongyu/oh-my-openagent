#![cfg(target_os = "linux")]

//! X11 desktop backend over pure-Rust x11rb (never links libX11/libxcb):
//! RandR display enumeration, EWMH window enumeration, root-window
//! `GetImage` capture, XTEST/`XSendEvent` input with the `_NET_ACTIVE_WINDOW`
//! focus guard, AT-SPI accessibility, and the XI2 raw-key kill switch (the
//! `Global` stop path).

mod backend;
mod capture;
mod input;
mod stop_path;

#[cfg(test)]
mod backend_tests;

pub use backend::X11Backend;
pub use capture::{X11Capture, X11Connection};
pub use input::{X11Input, X11InputConnection};
pub use stop_path::{Xi2Listener, DEFAULT_STOP_CHORD};

pub const BACKEND_NAME: &str = env!("CARGO_PKG_NAME");
