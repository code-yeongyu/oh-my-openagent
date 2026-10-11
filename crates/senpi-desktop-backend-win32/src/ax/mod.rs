//! UI Automation accessibility backend (parity port of oh-my-pi's
//! `win32/ax.rs`). Handles wrap `uiautomation::UIElement` in core's
//! session-thread `AxHandle::Native`; refs and generations stay in core's
//! `AxRegistry`. Never spawns PowerShell.

mod action;
mod automation;
mod patterns;
mod props;

use senpi_desktop_core::ax::{AxBackend, AxHandle, AxOwner, AxProps};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow};
use uiautomation::types::ControlType;
use uiautomation::UIElement;
use windows_sys::Win32::Foundation::{HWND, POINT};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT};

use self::action::UiaAction;
use self::automation::Automation;
use crate::capture::{all_displays, physical_point};

#[derive(Debug, Default)]
pub(crate) struct Win32Ax {
    automation: Automation,
    /// Display layout for element bounds, re-read at every `window_root`.
    displays: Option<Vec<DesktopDisplay>>,
}

impl Win32Ax {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn element(handle: &AxHandle) -> CoreResult<&UIElement> {
        handle
            .downcast_native::<UIElement>()
            .ok_or_else(|| DesktopError::ax_failed("UI Automation backend received a non-UIA handle"))
    }

    /// The cached layout, read on first use. Bounds are optional props: an
    /// unreadable layout leaves them out (and is retried) rather than
    /// failing the snapshot, as in oh-my-pi.
    fn displays(&mut self) -> Option<&[DesktopDisplay]> {
        if self.displays.is_none() {
            self.displays = all_displays().ok();
        }
        self.displays.as_deref()
    }

    fn host_root(&mut self, element: &UIElement) -> Option<HWND> {
        let walker = self.automation.walker().ok()?;
        let mut current = element.clone();
        for _ in 0..64 {
            if let Ok(handle) = current.get_native_window_handle() {
                let raw: isize = handle.into();
                if raw != 0 {
                    let hwnd = std::ptr::with_exposed_provenance_mut(
                        usize::from_ne_bytes(raw.to_ne_bytes()),
                    );
                    // SAFETY: [Category 8 - FFI boundary] UIA supplied the
                    // opaque HWND and Win32 validates it before returning its
                    // root.
                    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
                    return (!root.is_null()).then_some(root);
                }
            }
            current = walker.get_parent(&current).ok()?;
        }
        None
    }

    pub(crate) fn invoke_at_point(&mut self, root: HWND, point: POINT) -> CoreResult<bool> {
        // SAFETY: [Category 8 - FFI boundary] `point` is a scalar value and
        // Win32 returns an opaque handle.
        let visible = unsafe { WindowFromPoint(point) };
        // SAFETY: [Category 8 - FFI boundary] Win32 validates the returned
        // handle before returning its root.
        if visible.is_null() || unsafe { GetAncestor(visible, GA_ROOT) } != root {
            return Ok(false);
        }
        let walker = self.automation.walker()?;
        let mut element = self.automation.element_at((point.x, point.y))?;
        if self.host_root(&element) != Some(root) {
            return Ok(false);
        }
        for _ in 0..8 {
            let control = element.get_control_type().map_err(uia_error)?;
            if matches!(
                control,
                ControlType::Button
                    | ControlType::MenuItem
                    | ControlType::Hyperlink
                    | ControlType::CheckBox
                    | ControlType::RadioButton
                    | ControlType::TabItem
            ) {
                let rect = element.get_bounding_rectangle().map_err(uia_error)?;
                if point.x < rect.get_left()
                    || point.x >= rect.get_right()
                    || point.y < rect.get_top()
                    || point.y >= rect.get_bottom()
                    || !element.is_enabled().map_err(uia_error)?
                    || element.is_offscreen().map_err(uia_error)?
                    || self.host_root(&element) != Some(root)
                {
                    return Ok(false);
                }
                patterns::perform(&element, UiaAction::Press).map_err(|error| {
                    DesktopError::ax_failed(format!(
                        "UIA coordinate action failed and may already have taken effect; do not replay it automatically: {}",
                        error.message
                    ))
                })?;
                return Ok(true);
            }
            if !matches!(control, ControlType::Text | ControlType::Image) {
                break;
            }
            element = walker.get_parent(&element).map_err(uia_error)?;
        }
        Ok(false)
    }
}

/// A top-level HWND in the decimal form `windows()` lists (xcap's u32 id).
fn window_id(root: HWND) -> Option<String> {
    u32::try_from(root.addr()).ok().map(|id| id.to_string())
}

fn uia_error(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::ax_failed(format!("UI Automation failed: {error}"))
}

impl AxBackend for Win32Ax {
    fn window_root(&mut self, win: &DesktopWindow) -> CoreResult<AxHandle> {
        self.displays = None;
        self.automation.window_root(win).map(AxHandle::native)
    }

    fn props(&mut self, h: &AxHandle) -> CoreResult<AxProps> {
        let walker = self.automation.walker()?;
        props::read_props(Self::element(h)?, &walker, self.displays())
    }

    fn children(&mut self, h: &AxHandle) -> CoreResult<Vec<AxHandle>> {
        let element = Self::element(h)?;
        Ok(self
            .automation
            .walker()?
            .get_children(element)
            .unwrap_or_default()
            .into_iter()
            .map(AxHandle::native)
            .collect())
    }

    fn parent(&mut self, h: &AxHandle) -> CoreResult<Option<AxHandle>> {
        let element = Self::element(h)?;
        Ok(self
            .automation
            .walker()?
            .get_parent(element)
            .ok()
            .map(AxHandle::native))
    }

    /// Parses the action before touching the element, so an unknown action
    /// is `AxFailed` naming it whatever the handle.
    fn perform(&mut self, h: &AxHandle, action: &str) -> CoreResult<()> {
        let action = UiaAction::parse(action)?;
        patterns::perform(Self::element(h)?, action)
    }

    fn set_value(&mut self, h: &AxHandle, value: &str) -> CoreResult<()> {
        patterns::set_value(Self::element(h)?, value)
    }

    fn focus(&mut self, h: &AxHandle) -> CoreResult<()> {
        Self::element(h)?.set_focus().map_err(uia_error)
    }

    fn element_at(&mut self, x: f64, y: f64) -> CoreResult<Option<AxHandle>> {
        let displays = all_displays().map_err(|error| DesktopError::ax_failed(error.message))?;
        let point = physical_point(x, y, &displays)
            .ok_or_else(|| DesktopError::ax_failed("Win32 reported no active displays"))?;
        self.automation
            .element_at(point)
            .map(|element| Some(AxHandle::native(element)))
    }

    fn focused_element(&mut self) -> CoreResult<Option<AxHandle>> {
        self.automation
            .focused_element()
            .map(|element| Some(AxHandle::native(element)))
    }

    fn attributes(&mut self, h: &AxHandle) -> CoreResult<Vec<(String, String)>> {
        Ok(props::attributes(Self::element(h)?))
    }

    /// The top-level HWND above the element's nearest native window handle.
    fn owner(&mut self, h: &AxHandle, _windows: &[DesktopWindow]) -> CoreResult<AxOwner> {
        let element = Self::element(h)?;
        Ok(self
            .host_root(element)
            .and_then(window_id)
            .map_or(AxOwner::Unknown, AxOwner::Window))
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod live_tests;
