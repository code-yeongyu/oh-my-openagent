//! Wayland libei input, ScreenCast capture, compositor probes and the stop ladder.
//!
//! Row 51 (this crate's first row): input over libei - the portal RemoteDesktop session or a
//! `LIBEI_SOCKET`, bounded reconnect, the compositor-fed keymap resolved in the active group,
//! the region-covering preflight, and the release-on-close proof from SP-W's ledger.

#[cfg(target_os = "linux")]
mod backend;
#[cfg(target_os = "linux")]
pub mod clipboard;
#[cfg(target_os = "linux")]
pub mod consent;
#[cfg(all(target_os = "linux", any(test, feature = "fake")))]
pub mod fake;
#[cfg(target_os = "linux")]
pub mod input;
#[cfg(target_os = "linux")]
pub mod ledger;
#[cfg(target_os = "linux")]
pub mod portal;
#[cfg(target_os = "linux")]
pub mod release;
#[cfg(all(target_os = "linux", test))]
mod tests;
#[cfg(target_os = "linux")]
pub mod xkb;

#[cfg(target_os = "linux")]
pub use backend::{InputReport, InputRoute, Options, WaylandBackend, WAYLAND_BACKEND};
