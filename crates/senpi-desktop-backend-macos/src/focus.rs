//! Focus-guard primitives: the WindowServer front window, its restore, and the
//! symmetric key-focus hand-back after background keyboard delivery.

use core_graphics::window::{kCGNullWindowID, kCGWindowListOptionAll};
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
use objc2_core_foundation::{
    CFArray, CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType,
};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopWindow, FrontWindow};

use crate::ax;
use crate::input::MacInput;
use crate::skylight;

#[derive(Clone, Copy)]
struct WindowInfo {
    pid: u32,
    window_number: u32,
    layer: i32,
    on_screen: bool,
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(options: u32, relative_to_window: u32) -> *mut CFArray;
}

fn first_front_window(windows: &[WindowInfo], pid: u32) -> Option<u32> {
    windows
        .iter()
        .find(|window| window.pid == pid && window.layer == 0 && window.on_screen)
        .map(|window| window.window_number)
}

/// The frontmost application's first visible, normal-layer WindowServer window.
/// AX provides its title, not its identity: AXFocusedWindow may be behind it.
pub(crate) fn front_window() -> CoreResult<Option<FrontWindow>> {
    let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() else {
        return Ok(None);
    };
    let pid = app.processIdentifier();
    let Ok(pid_u32) = u32::try_from(pid) else {
        return Ok(None);
    };
    let mut front = FrontWindow {
        pid: pid_u32,
        window_id: None,
        app: app
            .localizedName()
            .map_or_else(String::new, |name| name.to_string()),
        key_window_ax_title: None,
    };
    let windows = window_info()?;
    if let Some(id) = first_front_window(&windows, pid_u32) {
        front.window_id = Some(id.to_string());
        if let Ok(application) = ax::element::create_application(pid) {
            front.key_window_ax_title = ax::element::copy_elements(&application, "AXWindows")
                .and_then(|windows| {
                    windows
                        .iter()
                        .find(|window| ax::element::window_id(window) == Some(id))
                        .and_then(|window| ax::element::copy_string(window, "AXTitle"))
                });
        }
    }
    Ok(Some(front))
}

fn window_info() -> CoreResult<Vec<WindowInfo>> {
    // SAFETY: CoreGraphics returns a create-rule CFArray of immutable window
    // dictionaries; the retained wrapper owns it for the entire iteration.
    let raw = unsafe { CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID) };
    let raw = std::ptr::NonNull::new(raw).ok_or_else(|| {
        DesktopError::input_failed("copying the WindowServer front-to-back window list failed")
    })?;
    // SAFETY: CGWindowListCopyWindowInfo gives the caller a +1 CFArray.
    let array: CFRetained<CFArray> = unsafe { CFRetained::from_raw(raw) };
    // SAFETY: Each entry in the CoreGraphics window-info array is a CFDictionary.
    let array = unsafe { CFRetained::cast_unchecked::<CFArray<CFDictionary>>(array) };
    let pid_key = CFString::from_str("kCGWindowOwnerPID");
    let number_key = CFString::from_str("kCGWindowNumber");
    let layer_key = CFString::from_str("kCGWindowLayer");
    let on_screen_key = CFString::from_str("kCGWindowIsOnscreen");
    Ok(array
        .iter()
        .filter_map(|entry| {
            // SAFETY: CoreGraphics window-info dictionaries have CFString keys
            // and CFType values; downcasts below reject absent or wrong types.
            let entry =
                unsafe { CFRetained::cast_unchecked::<CFDictionary<CFString, CFType>>(entry) };
            Some(WindowInfo {
                pid: u32::try_from(entry.get(&pid_key)?.downcast::<CFNumber>().ok()?.as_i64()?)
                    .ok()?,
                window_number: u32::try_from(
                    entry
                        .get(&number_key)?
                        .downcast::<CFNumber>()
                        .ok()?
                        .as_i64()?,
                )
                .ok()?,
                layer: entry
                    .get(&layer_key)?
                    .downcast::<CFNumber>()
                    .ok()?
                    .as_i32()?,
                on_screen: entry
                    .get(&on_screen_key)?
                    .downcast::<CFBoolean>()
                    .ok()?
                    .as_bool(),
            })
        })
        .collect())
}

/// Restores the captured process and window through SkyLight (or public
/// activation if the foreground SPI is unavailable).
pub(crate) fn restore_front_window(front: &FrontWindow) -> CoreResult<()> {
    let pid = front_pid(front)?;
    let window_id = front
        .window_id
        .as_deref()
        .and_then(|id| id.parse::<u32>().ok());
    let restored_with_spi = skylight::psn_for_process(pid, window_id.unwrap_or(0))
        .is_some_and(|psn| skylight::set_front_process(&psn, window_id.unwrap_or(0)));
    if !restored_with_spi {
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid).ok_or_else(
            || {
                DesktopError::window_not_found(format!(
                    "application process {pid} for the previous front window is no longer running"
                ))
            },
        )?;
        #[expect(
            deprecated,
            reason = "restoring the prior frontmost app must override the current one"
        )]
        let options = NSApplicationActivationOptions::ActivateIgnoringOtherApps;
        if !app.activateWithOptions(options) {
            return Err(DesktopError::input_failed(format!(
                "restoring the previous front window of process {pid} was rejected"
            )));
        }
    }
    Ok(())
}

/// Hands key focus back to `front` after a background action that took it.
///
/// The previous design posted the symmetric SkyLight defocus/focus records;
/// on macOS 26 the defocus record posted to a background target is delivered
/// to that application as a destructive input event (observed live: the typed
/// document text was wiped), so the restore instead re-activates the previous
/// application - which is the frontmost one, so nothing raises or changes -
/// and then marks its window main/focused through AX as belt-and-braces.
pub(crate) fn restore_key_focus(input: &mut MacInput, front: &FrontWindow) -> CoreResult<()> {
    let Ok(prev_pid) = libc::pid_t::try_from(front.pid) else {
        return Ok(());
    };
    if input.take_last_activated().is_some() {
        reactivate(prev_pid);
    }
    mark_key_window(front)
}

/// The AX belt-and-braces half: mark `front`'s window main and focused.
pub(crate) fn mark_key_window(front: &FrontWindow) -> CoreResult<()> {
    let Some(id) = front.window_id.as_deref() else {
        return Ok(());
    };
    let window = DesktopWindow {
        id: id.to_string(),
        title: String::new(),
        app: front.app.clone(),
        pid: Some(front.pid),
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        focused: false,
        elevated: None,
    };
    let _ = ax::focus_key_window(&window);
    Ok(())
}

/// Re-activates the previous application so global keys land there; this
/// process-level operation does not select a particular window.
fn reactivate(pid: libc::pid_t) {
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        #[expect(
            deprecated,
            reason = "restoring key focus to the frontmost app must override the background target"
        )]
        let options = NSApplicationActivationOptions::ActivateIgnoringOtherApps;
        let _ = app.activateWithOptions(options);
    }
}

fn front_pid(front: &FrontWindow) -> CoreResult<libc::pid_t> {
    libc::pid_t::try_from(front.pid).map_err(|_| {
        DesktopError::input_failed(format!(
            "the previous front window has an invalid process id {}",
            front.pid
        ))
    })
}

#[cfg(test)]
#[path = "focus_tests.rs"]
mod tests;
