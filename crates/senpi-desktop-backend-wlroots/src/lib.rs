#![cfg(target_os = "linux")]

//! wlroots desktop backend for the compositor IPC every wlroots shell exposes,
//! written for sway: window and display enumeration and focus over the sway
//! IPC socket (`$SWAYSOCK`, the `i3-ipc` framing), capture through `grim`
//! (wlr-screencopy), keyboard input through `wtype` (the
//! `zwp_virtual_keyboard_v1` protocol) and pointer input through a direct
//! `zwlr_virtual_pointer_v1` client, none of which needs a portal. The stop
//! ladder subscribes to sway binding events, which fire only for bindings the
//! user's sway config declares, so the documented setup adds one `bindsym`
//! matching the stop chord (see [`SwayBindListener`]).
//!
//! Selected by [`senpi_desktop_session`] only where `SWAYSOCK` names a live
//! socket and the session bus offers no RemoteDesktop portal: with the
//! portal, the libei backend ([`senpi_desktop_backend_wayland`]) stays
//! preferable, and this backend changes nothing about its refusal semantics.

mod backend;
mod capture;
mod command;
mod input;
pub mod ipc;
mod pointer;
mod stop_path;

pub use backend::WlrootsBackend;
pub use command::{CommandRunner, ProcessRunner};
pub use stop_path::{SwayBindListener, STOP_PATH_UNAVAILABLE};
pub use sway_support::sway_socket_path;

/// Selection helper shared by the session's backend choice and the engine's
/// stop-path choice: the sway IPC socket this session should use, when its
/// environment names one that exists.
pub mod sway_support {
    use std::ffi::OsString;
    use std::os::unix::fs::FileTypeExt as _;
    use std::os::unix::net::UnixStream;
    use std::path::PathBuf;

    /// `$SWAYSOCK` when it names a socket a compositor is actually serving —
    /// the file type alone is not enough, because a socket file outlives its
    /// listener — else `None`.
    #[must_use]
    pub fn sway_socket_path(env: &dyn Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
        let socket = env("SWAYSOCK")?;
        let path = PathBuf::from(&socket);
        let is_socket = std::fs::metadata(&path)
            .ok()
            .filter(|metadata| metadata.file_type().is_socket())
            .is_some();
        if !is_socket {
            return None;
        }
        // Only a connection proves the listener is live; a stale socket file
        // keeps its inode but refuses the connect. The probe client sends
        // nothing and closes, so the compositor never serves a request.
        UnixStream::connect(&path).ok()?;
        Some(path)
    }
}

pub const BACKEND_NAME: &str = env!("CARGO_PKG_NAME");

#[cfg(test)]
mod backend_tests;
#[cfg(test)]
mod capture_tests;
#[cfg(test)]
mod ipc_tests;
#[cfg(test)]
mod pointer_tests;
#[cfg(test)]
mod stop_path_tests;
#[cfg(test)]
pub(crate) mod test_support;
