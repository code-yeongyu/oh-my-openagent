//! Deterministic fixtures for the display-free suites: a fake EIS server on
//! `reis::eis` and a fake xdg-desktop-portal on a private D-Bus bus.

pub mod fake_eis;
pub mod fake_portal;
mod portal_ifaces;
pub mod screenshot_iface;

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

/// Bound on every wait for a fixture's signal: a hang guard, never a latency
/// assertion.
pub const HANG_GUARD: Duration = Duration::from_secs(30);

/// Held by every test that reads or writes process environment
/// (`LIBEI_SOCKET`, `DBUS_SESSION_BUS_ADDRESS`) or talks to the portal:
/// ashpd caches one session-bus connection per process.
static ENV: Mutex<()> = Mutex::new(());

pub fn env_lock() -> MutexGuard<'static, ()> {
    ENV.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Sets `LIBEI_SOCKET` (or removes it) for the guard's lifetime.
pub struct LibeiSocketEnv {
    previous: Option<std::ffi::OsString>,
}

impl LibeiSocketEnv {
    pub fn set(value: Option<&std::path::Path>) -> Self {
        let previous = std::env::var_os("LIBEI_SOCKET");
        match value {
            Some(path) => std::env::set_var("LIBEI_SOCKET", path),
            None => std::env::remove_var("LIBEI_SOCKET"),
        }
        Self { previous }
    }
}

impl Drop for LibeiSocketEnv {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(previous) => std::env::set_var("LIBEI_SOCKET", previous),
            None => std::env::remove_var("LIBEI_SOCKET"),
        }
    }
}
