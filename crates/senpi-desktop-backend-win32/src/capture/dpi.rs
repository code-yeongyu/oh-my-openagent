//! Per-monitor-v2 DPI awareness. The engine is a plain binary without an
//! application manifest, so it must opt in itself before xcap or any geometry
//! call observes the desktop; otherwise Windows virtualizes every rect to
//! 96 DPI and captures stop matching the coordinates input is sent in.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use windows_sys::Win32::UI::HiDpi::{
    GetAwarenessFromDpiAwarenessContext, GetDpiAwarenessContextForProcess, SetProcessDpiAwarenessContext,
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, DPI_AWARENESS_PER_MONITOR_AWARE,
};

/// Puts the process in the per-monitor-v2 regime. The awareness is fixed once
/// per process, so a later call (the next `session.open`) fails with access
/// denied; that is success when the regime already in force is per-monitor.
///
/// # Errors
/// `CaptureFailed` when the process is locked into a non-per-monitor regime.
pub(crate) fn enable_per_monitor_awareness() -> CoreResult<()> {
    // SAFETY: [FFI] the argument is the documented PER_MONITOR_AWARE_V2
    // pseudo-handle constant; the call reads no caller memory.
    if unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) } != 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if process_is_per_monitor_aware() {
        return Ok(());
    }
    Err(DesktopError::capture_failed(format!(
        "Win32 could not enable per-monitor DPI awareness: {error}"
    )))
}

fn process_is_per_monitor_aware() -> bool {
    // SAFETY: [FFI] a null process handle is documented to select the calling
    // process; the call returns a context value and writes no caller memory.
    let context = unsafe { GetDpiAwarenessContextForProcess(std::ptr::null_mut()) };
    // SAFETY: [FFI] `context` is the value the system just returned; the call
    // only decodes it.
    let awareness = unsafe { GetAwarenessFromDpiAwarenessContext(context) };
    awareness == DPI_AWARENESS_PER_MONITOR_AWARE
}
