//! Windows desktop backend: xcap (GDI) capture and display/window
//! enumeration in the per-monitor-v2 DPI regime, UI Automation
//! accessibility, the mandatory integrity label of the engine and of each
//! window's process, `SendInput`/enigo input behind the
//! `SetForegroundWindow` focus guard, `PostMessageW` background input gated
//! by the toolkit class matrix, and the `RegisterHotKey` kill switch (the
//! `Global` stop path).
//!
//! The class matrix ([`delivery`]), the key vocabulary ([`input::keys`]),
//! and the stop-chord mapping ([`stop_path::chord`]) are pure and compile on
//! every host so their tests run everywhere; everything else is Windows-only.

pub mod delivery;
pub mod input;
pub mod stop_path;

#[cfg(target_os = "windows")]
mod ax;
#[cfg(target_os = "windows")]
mod backend;
#[cfg(target_os = "windows")]
mod capture;
#[cfg(target_os = "windows")]
mod integrity;

#[cfg(target_os = "windows")]
pub use backend::Win32Backend;
#[cfg(target_os = "windows")]
pub use stop_path::HotkeyListener;
pub use stop_path::DEFAULT_STOP_CHORD;

pub const BACKEND_NAME: &str = env!("CARGO_PKG_NAME");
