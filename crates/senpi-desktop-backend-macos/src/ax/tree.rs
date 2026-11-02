//! Tree navigation: native window -> AX root, children/parent, hit-testing,
//! the focused element, and the raw attribute dump.

use std::collections::HashSet;
use std::ptr::{self, NonNull};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::Duration;

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFBoolean, CFRetained, CFString};
use senpi_desktop_core::ax::AxBounds;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use super::element::{self, ax_result, copy_string, set_timeout};
use super::props::{stringify_value, truncate_chars};

type Element = CFRetained<AXUIElement>;

/// Processes already asked to expose their renderer accessibility tree.
static MANUAL_ACCESSIBILITY: LazyLock<Mutex<HashSet<libc::pid_t>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// The AX window element for a native window: matched by CGWindowID through
/// the private SPI, else by title plus frame, else by a unique title.
pub(super) fn window_root(win: &DesktopWindow) -> CoreResult<Element> {
    element::ensure_trusted()?;
    let pid = win
        .pid
        .ok_or_else(|| DesktopError::ax_failed(format!("window {} has no owning process id", win.id)))?;
    let pid = libc::pid_t::try_from(pid)
        .map_err(|_| DesktopError::ax_failed(format!("window {} has an invalid process id", win.id)))?;
    let app = element::create_application(pid)?;
    set_timeout(&app)?;
    enable_web_accessibility(pid, &app);
    let windows = element::copy_elements(&app, "AXWindows")
        .ok_or_else(|| DesktopError::ax_failed("copying AXWindows failed"))?;
    let expected_id = win.id.parse::<u32>().ok();
    let by_id = expected_id.and_then(|expected| {
        windows
            .iter()
            .find(|window| element::window_id(window) == Some(expected))
            .cloned()
    });
    let found = by_id.or_else(|| {
        // Older systems may hide the private window-id SPI.
        let candidates = windows.into_iter().map(|window| {
            let title = copy_string(&window, "AXTitle").unwrap_or_default();
            let bounds = element::bounds(&window);
            (window, title, bounds)
        });
        pick_by_title_and_frame(candidates, win)
    });
    let found = found.ok_or_else(|| {
        DesktopError::ax_failed(format!(
            "accessibility window for native window {} ('{}') was not found",
            win.id, win.title,
        ))
    })?;
    set_timeout(&found)?;
    Ok(found)
}

/// Title and global frame together win at once; a title alone only when it
/// is unique among the candidates.
pub(super) fn pick_by_title_and_frame<T>(
    candidates: impl IntoIterator<Item = (T, String, Option<AxBounds>)>,
    win: &DesktopWindow,
) -> Option<T> {
    let mut title_match = None;
    for (candidate, title, bounds) in candidates {
        if title != win.title {
            continue;
        }
        if bounds.is_some_and(|bounds| bounds_matches_window(bounds, win)) {
            return Some(candidate);
        }
        if title_match.is_some() {
            return None;
        }
        title_match = Some(candidate);
    }
    title_match
}

pub(super) fn bounds_matches_window(bounds: AxBounds, window: &DesktopWindow) -> bool {
    (bounds.x - f64::from(window.x)).abs() <= 2.0
        && (bounds.y - f64::from(window.y)).abs() <= 2.0
        && (bounds.width - f64::from(window.width)).abs() <= 2.0
        && (bounds.height - f64::from(window.height)).abs() <= 2.0
}

/// Chromium-family apps build their renderer tree lazily. Reading the app role
/// activates modern Chrome's native AX mode; older Chromium/Electron builds
/// honor `AXManualAccessibility`. A process rejecting the setter costs no wait.
fn enable_web_accessibility(pid: libc::pid_t, app: &AXUIElement) {
    let _ = copy_string(app, "AXRole");
    {
        let mut enabled = MANUAL_ACCESSIBILITY
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !enabled.insert(pid) {
            return;
        }
        let attribute = CFString::from_str("AXManualAccessibility");
        // SAFETY: The retained element, attribute, and singleton CFBoolean stay
        // valid for the synchronous setter call.
        let error = unsafe { app.set_attribute_value(&attribute, CFBoolean::new(true)) };
        if error != AXError::Success {
            // Manual activation is unsupported; leave no stale pid marker.
            enabled.remove(&pid);
            return;
        }
    }
    // Renderers publish their trees over IPC after the switch flips; the first
    // snapshot would otherwise race a still-empty web area.
    thread::sleep(Duration::from_millis(500));
}

pub(super) fn children(element: &AXUIElement) -> Vec<Element> {
    element::copy_elements(element, "AXChildren").unwrap_or_default()
}

pub(super) fn parent(element: &AXUIElement) -> Option<Element> {
    element::copy_element(element, "AXParent")
}

pub(super) fn element_at(x: f64, y: f64) -> CoreResult<Option<Element>> {
    element::ensure_trusted()?;
    let in_range = |value: f64| value.is_finite() && value.abs() <= f64::from(f32::MAX);
    if !in_range(x) || !in_range(y) {
        return Err(DesktopError::ax_failed(format!(
            "AX hit-test point ({x}, {y}) is outside the platform range"
        )));
    }
    let system = element::create_system_wide();
    set_timeout(&system)?;
    let mut output: *const AXUIElement = ptr::null();
    let slot = NonNull::from(&mut output);
    // Range-checked above; the AX hit-test API takes f32 points and std has no
    // lossless f64 -> f32 conversion.
    let (x32, y32) = (x as f32, y as f32);
    // SAFETY: `slot` is writable and the system-wide element stays retained
    // through the synchronous hit-test.
    let error = unsafe { system.copy_element_at_position(x32, y32, slot) };
    if error == AXError::NoValue {
        return Ok(None);
    }
    ax_result(error, format!("AX hit-test at ({x}, {y}) failed"))?;
    element::retained_element(output).map(Some)
}

pub(super) fn focused_element() -> CoreResult<Option<Element>> {
    element::ensure_trusted()?;
    let system = element::create_system_wide();
    set_timeout(&system)?;
    Ok(element::copy_element(&system, "AXFocusedUIElement"))
}

/// Every attribute name with its value rendered and truncated to 200 chars.
pub(super) fn attributes(element: &AXUIElement) -> CoreResult<Vec<(String, String)>> {
    // SAFETY: The slot is writable and receives a create-rule CFArray.
    let names =
        element::copy_name_array(|slot| unsafe { element.copy_attribute_names(slot) }).map_err(|error| {
            DesktopError::ax_failed(format!("AXUIElementCopyAttributeNames failed ({error:?})"))
        })?;
    Ok(names
        .into_iter()
        .map(|name| {
            let value = element::copy_attribute(element, &name)
                .map_or_else(|| "<no value>".to_string(), |value| stringify_value(&value));
            (name, truncate_chars(value, 200))
        })
        .collect())
}
