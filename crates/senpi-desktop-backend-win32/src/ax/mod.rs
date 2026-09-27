//! UI Automation accessibility backend (parity port of oh-my-pi's
//! `win32/ax.rs`). Handles wrap `uiautomation::UIElement` in core's
//! session-thread `AxHandle::Native`; refs and generations stay in core's
//! `AxRegistry`. Never spawns PowerShell.

mod action;
mod automation;
mod patterns;
mod props;

use senpi_desktop_core::ax::{AxBackend, AxHandle, AxProps};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow};
use uiautomation::UIElement;

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
}

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod live_tests;
