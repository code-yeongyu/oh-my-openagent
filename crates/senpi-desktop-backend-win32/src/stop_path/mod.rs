//! The Windows `Global` stop path: on the dedicated
//! `senpi-desktop-killswitch` thread a `WH_KEYBOARD_LL` hook latches the
//! supervisor when a person presses the stop chord, and the thread's
//! `MsgWaitForMultipleObjects` loop beats every 500 ms while the hook is
//! installed. Injected key events (`LLKHF_INJECTED`: `SendInput`, the
//! engine's own input, any other process) never stop input. Low-level hooks
//! are not exclusive, so every session's engine arms its own stop; a
//! `RegisterHotKey` registration, held by whichever process gets it, backs
//! the hook up while an elevated foreground window keeps the hook blind.
//!
//! The chord mapping ([`chord`]) and the physical-chord rules ([`physical`])
//! are pure and tested on every host.

pub mod chord;
#[cfg_attr(
    not(target_os = "windows"),
    allow(dead_code, reason = "only the Windows hook uses it; built everywhere so its tests run on every host")
)]
mod physical;

#[cfg(target_os = "windows")]
mod hook;
#[cfg(target_os = "windows")]
mod hotkey;
#[cfg(target_os = "windows")]
mod listener;

#[cfg(all(test, target_os = "windows"))]
mod live_tests;

pub use chord::DEFAULT_STOP_CHORD;
#[cfg(target_os = "windows")]
pub use listener::HotkeyListener;
