#![cfg(target_os = "linux")]

//! Wayland desktop backend, pure Rust (no libxkbcommon, no PipeWire):
//! libei input through `LIBEI_SOCKET` or a RemoteDesktop portal session
//! with group-aware XKB keymap resolution, Screenshot-portal capture, AT-SPI
//! accessibility, honest background-only capabilities, and the
//! GlobalShortcuts-portal stop path.

mod backend;
mod capture;
mod compositor {
    pub mod gnome;
    pub mod hyprland;
    pub mod kwin;
}
mod input;
#[cfg(test)]
mod live_tests;
mod portal;
mod stop_path;
#[cfg(test)]
mod test_support;

pub use backend::WaylandBackend;
pub use stop_path::{GlobalShortcutsListener, STOP_SHORTCUT_ID, UNAVAILABLE as STOP_PATH_UNAVAILABLE};

/// Whether the session bus offers the RemoteDesktop portal: backend
/// selection keeps this backend's portal-mediated input whenever it does,
/// and takes a wlroots compositor's native tools only when it does not.
pub fn remote_desktop_portal_offered() -> bool {
    crate::portal::portal_runtime().is_ok_and(crate::portal::remote_desktop::is_offered)
}

pub const BACKEND_NAME: &str = env!("CARGO_PKG_NAME");
