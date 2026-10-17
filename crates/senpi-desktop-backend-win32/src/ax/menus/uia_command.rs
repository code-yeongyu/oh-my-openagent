//! Invokable command patterns, never SelectionItem or ExpandCollapse.

use super::super::uia_error;
use crate::menus::failed;
use senpi_desktop_core::error::CoreResult;
use uiautomation::{
    patterns::{UIInvokePattern, UILegacyIAccessiblePattern, UITogglePattern},
    UIElement,
};

pub(super) enum Command {
    Invoke(UIInvokePattern),
    Legacy(UILegacyIAccessiblePattern),
    Toggle(UITogglePattern),
}

impl Command {
    pub fn new(element: &UIElement) -> CoreResult<Self> {
        if let Ok(pattern) = element.get_pattern::<UIInvokePattern>() {
            return Ok(Self::Invoke(pattern));
        }
        if let Ok(pattern) = element.get_pattern::<UILegacyIAccessiblePattern>() {
            if pattern.get_default_action().map_err(uia_error)?.trim().is_empty() {
                return Err(failed("UIA menu command has no invokable default action"));
            }
            return Ok(Self::Legacy(pattern));
        }
        element
            .get_pattern::<UITogglePattern>()
            .map(Self::Toggle)
            .map_err(|_| failed("UIA menu command has no supported command pattern"))
    }

    pub fn run(self) -> CoreResult<()> {
        match self {
            Self::Invoke(pattern) => pattern.invoke(),
            Self::Legacy(pattern) => pattern.do_default_action(),
            Self::Toggle(pattern) => pattern.toggle(),
        }.map_err(|error| failed(format!("UIA menu command failed and may already have taken effect; do not replay automatically: {error}")))
    }
}
