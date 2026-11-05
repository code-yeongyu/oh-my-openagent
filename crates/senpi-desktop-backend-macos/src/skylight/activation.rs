//! The SkyLight primitives that tell a background application it is active
//! with one window key, as `AppKit` does for a real activation, while
//! `WindowServer`'s front process stays the user's (ported from oh-my-pi
//! 18.13.1 `macos/skylight.rs` `set_fields`, `post_activation`,
//! `sender_connection`).

use core_graphics::event::CGEvent;
use core_graphics::geometry::CGPoint;
use foreign_types::ForeignType;
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::spi::required;

/// Stamps raw SkyLight integer fields onto `event`.
pub(crate) fn set_fields(event: &CGEvent, fields: &[(u32, i64)]) -> CoreResult<()> {
    let spi = required()?;
    for &(field, value) in fields {
        // SAFETY: The event is alive for the call and the setter passed the
        // atomic exact-signature probe.
        unsafe { (spi.set_integer)(event.as_ptr().cast(), field, value) };
    }
    Ok(())
}

/// Stamps a window-local point, measured from the window's top-left including
/// its title bar, for hit-testing a pid-addressed pointer event.
pub(crate) fn set_window_location(event: &CGEvent, location: CGPoint) -> CoreResult<()> {
    let spi = required()?;
    // SAFETY: The event is alive for the call and the setter passed the atomic
    // exact-signature probe.
    unsafe { (spi.set_window_location)(event.as_ptr().cast(), location) };
    Ok(())
}

/// Posts an event that only makes a window key, outside its frame, through
/// SkyLight alone. No input of the call reaches the target, so it does not
/// mark the call sent ([`super::reporting_partial`]).
pub(crate) fn post_activation(pid: libc::pid_t, event: &CGEvent) -> CoreResult<()> {
    let spi = required()?;
    // SAFETY: `event` remains retained for the synchronous post and
    // `post_to_pid` was atomically resolved with its exact ABI.
    unsafe { (spi.post_to_pid)(pid, event.as_ptr().cast()) };
    Ok(())
}

/// This process's `WindowServer` connection, which `AppKit` stamps on the
/// window events it builds as their window context.
pub(crate) fn sender_connection() -> CoreResult<i64> {
    let connection = required()?.psn.main_connection.ok_or_else(|| {
        DesktopError::background_unavailable(
            "the WindowServer connection query is unavailable, so a background window cannot be made \
             key; nothing was sent",
        )
    })?;
    // SAFETY: The no-argument connection query was resolved with its exact
    // signature.
    Ok(i64::from(unsafe { connection() }))
}
