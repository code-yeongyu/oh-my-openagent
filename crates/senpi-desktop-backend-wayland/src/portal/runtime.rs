//! The one Tokio runtime every xdg-desktop-portal caller shares.

use std::sync::LazyLock;
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use tokio::runtime::{Builder, Runtime};

/// Bound on closing a portal session, so an unresponsive
/// `xdg-desktop-portal` cannot hang teardown.
pub const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

/// Process-wide runtime shared by every portal call (oh-my-pi portal.rs:88-101).
///
/// `ashpd` caches a process-global D-Bus connection whose I/O tasks are bound
/// to the runtime that first creates it. A long-lived multi-thread runtime
/// keeps that connection alive and drives it while portal callers block.
static PORTAL_RUNTIME: LazyLock<Result<Runtime, String>> = LazyLock::new(|| {
    Builder::new_multi_thread()
        .worker_threads(1)
        .thread_name("senpi-desktop-portal")
        .enable_all()
        .build()
        .map_err(|err| err.to_string())
});

/// Borrows the shared portal runtime, surfacing a one-time build failure.
///
/// # Errors
/// `Internal` when the runtime could not be built.
pub fn portal_runtime() -> CoreResult<&'static Runtime> {
    PORTAL_RUNTIME
        .as_ref()
        .map_err(|err| DesktopError::internal(format!("xdg-desktop-portal runtime: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every portal caller (libei input, the GlobalShortcuts listener, and
    /// capture) must borrow one persistent runtime; per-call runtimes would
    /// orphan ashpd's cached connection (oh-my-pi #7886).
    #[test]
    fn portal_runtime_is_shared_across_calls() {
        let first = portal_runtime().expect("portal runtime builds");
        let second = portal_runtime().expect("portal runtime builds");
        assert!(
            std::ptr::eq(first, second),
            "portal_runtime must hand back one long-lived runtime, not a fresh per-call instance"
        );
    }
}
