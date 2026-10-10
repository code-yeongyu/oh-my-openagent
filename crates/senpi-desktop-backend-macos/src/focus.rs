//! Focus-guard primitives: the WindowServer front window, its restore, and the
//! symmetric key-focus hand-back after background keyboard delivery.

use std::time::{Duration, Instant};

use core_graphics::window::{kCGNullWindowID, kCGWindowListOptionAll};
use objc2_app_kit::{
    NSApplicationActivationOptions, NSRunningApplication,
};
use objc2_core_foundation::{
    CFArray, CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType,
};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopWindow, FrontWindow};

use crate::ax;
use crate::input::MacInput;
use crate::front_app::{current_front_pid, restore_step, RestoreStep};
use crate::skylight;

#[derive(Clone, Copy)]
pub(crate) struct WindowInfo {
    pub(crate) pid: u32,
    pub(crate) window_number: u32,
    pub(crate) layer: i32,
    pub(crate) on_screen: bool,
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
    let Some(pid) = current_front_pid() else {
        return Ok(None);
    };
    let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else {
        return Ok(None);
    };
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

pub(crate) fn window_info() -> CoreResult<Vec<WindowInfo>> {
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

/// How long a restored application may take to come back and stay the user's front app.
const RESTORE_DEADLINE: Duration = Duration::from_millis(1500);
/// How long the restored application must stay front before the restore counts.
const RESTORE_STABLE: Duration = Duration::from_millis(250);
/// How often the restore re-asks when another activation took the front back.
const REACTIVATE_INTERVAL: Duration = Duration::from_millis(200);

/// Restores the captured application and window: SkyLight selects the window,
/// accessibility and AppKit activate the application, and the restore counts
/// only once the live front app (see [`current_front_pid`]) has stayed that application for
/// [`RESTORE_STABLE`], re-asking while the engine's own activation (or an accessory panel) holds the
/// front. When the user has switched to another regular app, the restore leaves it there (#9056).
///
/// # Errors
/// `FocusRestoreFailed`-worthy input error when the application is gone or does
/// not become the front app within [`RESTORE_DEADLINE`].
pub(crate) fn restore_front_window(front: &FrontWindow) -> CoreResult<()> {
    let pid = front_pid(front)?;
    let window_id = front
        .window_id
        .as_deref()
        .and_then(|id| id.parse::<u32>().ok())
        .unwrap_or(0);
    if let Some(psn) = skylight::psn_for_process(pid, window_id) {
        let _ = skylight::set_front_process(&psn, window_id);
    }
    let engine_activated = crate::front_app::last_engine_activation();
    skylight::activate_application(pid)?;
    let started = Instant::now();
    let mut front_since: Option<Instant> = None;
    let mut last_request = started;
    loop {
        let now = Instant::now();
        match restore_step(pid, current_front_pid(), engine_activated, crate::front_app::is_regular) {
            RestoreStep::Front => {
                let since = *front_since.get_or_insert(now);
                if now.duration_since(since) >= RESTORE_STABLE {
                    return Ok(());
                }
            }
            // The user switched to another app after the action: leave it front and do not claim a restore
            // (#9056); the previous app is simply no longer the one to put back.
            RestoreStep::UserMovedOn => return Ok(()),
            RestoreStep::Reclaim => {
                front_since = None;
                // Our own activation (or an accessory panel) still holds the front; ask again.
                if now.duration_since(last_request) >= REACTIVATE_INTERVAL {
                    let _ = skylight::activate_application(pid);
                    last_request = now;
                }
            }
        }
        if now.duration_since(started) >= RESTORE_DEADLINE {
            return Err(DesktopError::input_failed(format!(
                "the previous front application (process {pid}, {}) did not stay in front for {} ms within {} ms",
                front.app,
                RESTORE_STABLE.as_millis(),
                RESTORE_DEADLINE.as_millis()
            )));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
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
    let activated = input.take_last_activated().map(|(pid, _)| pid);
    match hand_back(prev_pid, activated, current_front_pid()) {
        HandBack::Reactivate => reactivate(prev_pid),
        HandBack::AlreadyFront => {}
        // The user moved to another application during the action; that newer
        // choice wins over the snapshot (as on X11 and Windows).
        HandBack::UserMovedOn => return Ok(()),
    }
    mark_key_window(front)
}

/// What key-focus hand-back does, from the snapshot, the application the
/// engine made key, and the live front application.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HandBack {
    /// The engine's activation is still in effect: give focus back.
    Reactivate,
    /// The snapshot's application is front already.
    AlreadyFront,
    /// A third application is front: the user moved on; leave it.
    UserMovedOn,
}

pub(crate) fn hand_back(
    previous: libc::pid_t,
    activated: Option<libc::pid_t>,
    front: Option<libc::pid_t>,
) -> HandBack {
    match front {
        Some(front) if front == previous => HandBack::AlreadyFront,
        Some(front) if Some(front) != activated => HandBack::UserMovedOn,
        _ if activated.is_some() => HandBack::Reactivate,
        _ => HandBack::AlreadyFront,
    }
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
