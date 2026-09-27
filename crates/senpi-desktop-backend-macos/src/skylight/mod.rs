//! Background event delivery through WindowServer's private SkyLight SPI:
//! per-window event stamping, dual posting, focus-without-raise records, and
//! the foreground transaction.
//!
//! The Background path must never route through `CGEventPost(kCGHIDEventTap)`;
//! posting is `SLEventPostToPid` (plus the public per-pid supplement for plain
//! AppKit) only.

mod authentication;
mod psn;
mod spi;

use std::thread;
use std::time::Duration;

use core_graphics::event::CGEvent;
use core_graphics::geometry::CGPoint;
use foreign_types::ForeignType;
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use self::psn::{
    front_process, post_focus_record, process_psn, FocusMarker, ProcessSerialNumber,
    SET_FRONT_NO_WINDOWS,
};
pub(crate) use self::spi::is_available;
use self::spi::required;

/// Ensures the required background SPI resolved; the error names the missing
/// SkyLight symbols.
pub(crate) fn require_spi() -> CoreResult<()> {
    required().map(|_| ())
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventPostToPid(pid: libc::pid_t, event: core_graphics::sys::CGEventRef);
}

fn event_ptr(event: &CGEvent) -> *mut std::ffi::c_void {
    event.as_ptr().cast()
}

/// Stamps a pointer/scroll event with the window it belongs to: phase, click
/// state, button number, target pid/window, click group, and window-local
/// coordinates.
#[expect(
    clippy::too_many_arguments,
    reason = "the parameters are the native CGEvent fields stamped together"
)]
pub(crate) fn stamp_event(
    event: &CGEvent,
    pid: libc::pid_t,
    wid: u32,
    window_local: CGPoint,
    phase: i64,
    click_state: i64,
    button_number: i64,
    click_group: i64,
) -> CoreResult<()> {
    let spi = required()?;
    let ptr = event_ptr(event);
    // SAFETY: The event is alive for these calls; every function pointer passed
    // the atomic exact-signature probe.
    unsafe {
        (spi.set_integer)(ptr, 0, phase);
        (spi.set_integer)(ptr, 1, click_state);
        (spi.set_integer)(ptr, 3, button_number);
        (spi.set_integer)(ptr, 7, 3);
        (spi.set_integer)(ptr, 40, i64::from(pid));
        (spi.set_integer)(ptr, 51, i64::from(wid));
        (spi.set_integer)(ptr, 58, click_group);
        (spi.set_integer)(ptr, 91, i64::from(wid));
        (spi.set_integer)(ptr, 92, i64::from(wid));
        (spi.set_window_location)(ptr, window_local);
    }
    Ok(())
}

/// Posts a pointer event through SkyLight and the public per-pid queue. The
/// public post supplements a successful SkyLight post for plain AppKit; it is
/// never a fallback.
pub(crate) fn post_dual(pid: libc::pid_t, event: &CGEvent) -> CoreResult<()> {
    let spi = required()?;
    // SAFETY: `event` remains retained for both posts and `post_to_pid` was
    // atomically resolved with its exact ABI.
    unsafe { (spi.post_to_pid)(pid, event_ptr(event)) };
    // SAFETY: `event` remains retained for the synchronous public
    // CoreGraphics post to the same process.
    unsafe { CGEventPostToPid(pid, event.as_ptr()) };
    Ok(())
}

/// Posts a keyboard event through the authenticated SkyLight route only: the
/// same event through the public per-pid queue as well would deliver every key
/// twice.
pub(crate) fn post_keyboard(pid: libc::pid_t, event: &CGEvent) -> CoreResult<()> {
    let spi = required()?;
    authentication::attach_keyboard_authentication(pid, event);
    // SAFETY: `event` remains retained and the exact symbol is part of the
    // required atomic probe.
    unsafe { (spi.post_to_pid)(pid, event_ptr(event)) };
    Ok(())
}

/// Makes `(pid, wid)` the key window without raising it or changing the
/// frontmost application, then lets WindowServer settle.
pub(crate) fn activate_without_raise(pid: libc::pid_t, wid: u32) -> CoreResult<()> {
    let spi = required()?;
    let previous = front_process().ok_or_else(|| {
        DesktopError::background_unavailable(format!(
            "window {wid} could not resolve the front process for background input; retry with \
             delivery:\"foreground\" or use ax actions",
        ))
    })?;
    let target = psn_for_pid(spi.psn, pid).ok_or_else(|| {
        DesktopError::background_unavailable(format!(
            "window {wid} could not resolve its process serial number for background input; retry \
             with delivery:\"foreground\" or use ax actions",
        ))
    })?;
    let defocused = post_focus_record(&previous, 0, FocusMarker::Defocus);
    let focused = post_focus_record(&target, wid, FocusMarker::Focus);
    if !defocused || !focused {
        return Err(DesktopError::background_unavailable(format!(
            "window {wid} rejected the 248-byte SkyLight focus-without-raise record; retry with \
             delivery:\"foreground\" or use ax actions",
        )));
    }
    thread::sleep(Duration::from_millis(50));
    Ok(())
}

/// Runs `action` with `(pid, wid)`'s process in front, restoring the previous
/// front process after it. Falls back to the public `NSRunningApplication`
/// activation when the foreground SPI is unavailable.
pub(crate) fn with_foreground<T>(
    pid: libc::pid_t,
    wid: u32,
    action: impl FnOnce() -> CoreResult<T>,
) -> CoreResult<T> {
    let Some(spi) = spi::foreground() else {
        return with_public_foreground(pid, action);
    };
    let mut previous_record = ProcessSerialNumber::default();
    // SAFETY: `previous_record` is a writable PSN and the foreground-only
    // function pointer passed its exact-signature probe.
    let previous_known = unsafe { (spi.get_front)(&mut previous_record) } == 0;
    let previous = previous_known.then_some(previous_record);
    let Some(target) = psn_for_pid(spi.psn, pid) else {
        return with_public_foreground(pid, action);
    };
    // SAFETY: Target PSN is valid and SET_FRONT_NO_WINDOWS is kCPSNoWindows,
    // used only by this foreground delivery rung.
    if unsafe { (spi.set_front)(&target, wid, SET_FRONT_NO_WINDOWS) } != 0 {
        return with_public_foreground(pid, action);
    }
    thread::sleep(Duration::from_millis(40));
    let result = action();
    thread::sleep(Duration::from_millis(40));
    if let Some(previous) = previous {
        // SAFETY: The saved PSN came from WindowServer; window id 0 restores
        // that process after foreground input.
        unsafe { (spi.set_front)(&previous, 0, SET_FRONT_NO_WINDOWS) };
    }
    result
}

/// Focus restore: the PSN of `pid` when the SkyLight probe can produce one.
pub(crate) fn psn_for_process(pid: libc::pid_t, wid: u32) -> Option<ProcessSerialNumber> {
    spi::foreground().and_then(|spi| process_psn(spi.psn, pid, wid))
}

/// Sets `psn` front with the captured window id through the foreground SPI (the
/// `restore_front_window` primitive).
pub(crate) fn set_front_process(psn: &ProcessSerialNumber, wid: u32) -> bool {
    let Some(spi) = spi::foreground() else {
        return false;
    };
    // SAFETY: The PSN and window id came from WindowServer; kCPSNoWindows
    // avoids gathering other windows while restoring this exact window.
    let set = unsafe { (spi.set_front)(psn, wid, SET_FRONT_NO_WINDOWS) };
    set == 0
}

fn psn_for_pid(lookup: spi::PsnLookup, pid: libc::pid_t) -> Option<ProcessSerialNumber> {
    process_psn(lookup, pid, 0)
}

fn with_public_foreground<T>(
    pid: libc::pid_t,
    action: impl FnOnce() -> CoreResult<T>,
) -> CoreResult<T> {
    let workspace = NSWorkspace::sharedWorkspace();
    let previous = workspace.frontmostApplication();
    let target =
        NSRunningApplication::runningApplicationWithProcessIdentifier(pid).ok_or_else(|| {
            DesktopError::window_not_found(format!(
                "application process {pid} is no longer running"
            ))
        })?;
    #[expect(
        deprecated,
        reason = "public foreground fallback must override another frontmost app"
    )]
    let options = NSApplicationActivationOptions::ActivateAllWindows
        | NSApplicationActivationOptions::ActivateIgnoringOtherApps;
    if !target.activateWithOptions(options) {
        return Err(DesktopError::input_failed(format!(
            "public foreground activation for process {pid} was rejected"
        )));
    }
    thread::sleep(Duration::from_millis(40));
    let result = action();
    thread::sleep(Duration::from_millis(40));
    if let Some(previous) = previous {
        #[expect(
            deprecated,
            reason = "restoring the prior frontmost app requires the same activation option"
        )]
        let restore_options = NSApplicationActivationOptions::ActivateIgnoringOtherApps;
        let _ = previous.activateWithOptions(restore_options);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::psn::focus_record;
    use super::spi::{env_disables, skylight_available};
    use super::*;

    #[test]
    fn env_override_disables_the_spi_probe() {
        assert!(env_disables(Some("1")));
        assert!(!env_disables(Some("0")));
        assert!(!env_disables(Some("yes")));
        assert!(!env_disables(None));
        assert!(!skylight_available(true, true));
        assert!(!skylight_available(false, false));
        assert!(skylight_available(false, true));
    }

    #[test]
    fn focus_record_encodes_window_and_marker() {
        let record = focus_record(0x0a0b0c0d, FocusMarker::Focus);
        assert_eq!(record[0x04], 0xf8);
        assert_eq!(record[0x08], 0x0d);
        assert_eq!(&record[0x3c..0x40], &0x0a0b0c0d_u32.to_le_bytes());
        assert_eq!(record[0x8a], 0x01);
        assert_eq!(focus_record(7, FocusMarker::Defocus)[0x8a], 0x02);
    }
}
