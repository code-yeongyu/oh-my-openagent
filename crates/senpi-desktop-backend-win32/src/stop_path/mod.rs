//! The Windows `Global` stop path: on the dedicated
//! `senpi-desktop-killswitch` thread a `RegisterHotKey` registration latches
//! the supervisor when the stop chord goes down, and the thread's
//! `MsgWaitForMultipleObjects` loop beats every 500 ms while the
//! registration holds. `RegisterHotKey` is preferred over a
//! `WH_KEYBOARD_LL` hook (never used here): it costs nothing per keystroke,
//! cannot be timed out by the system, and fires whichever window has focus.
//!
//! The chord mapping ([`chord`]) is pure and tested on every host.

pub mod chord;

#[cfg(target_os = "windows")]
mod hotkey;
#[cfg(target_os = "windows")]
mod listener;

#[cfg(all(test, target_os = "windows"))]
mod live_tests;

pub use chord::DEFAULT_STOP_CHORD;
#[cfg(target_os = "windows")]
pub use listener::HotkeyListener;
