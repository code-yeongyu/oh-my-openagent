//! Control-pattern probing and dispatch: the actions an element supports,
//! `perform` over the pattern each action names, and value read/write through
//! `Value` with the `LegacyIAccessible` fallback.

use senpi_desktop_core::error::CoreResult;
use uiautomation::patterns::{
    UIExpandCollapsePattern, UIInvokePattern, UILegacyIAccessiblePattern, UIScrollItemPattern,
    UISelectionItemPattern, UITogglePattern, UIValuePattern,
};
use uiautomation::UIElement;

use super::action::{SupportedPatterns, UiaAction};
use super::uia_error;

pub(super) fn supported(element: &UIElement) -> SupportedPatterns {
    SupportedPatterns {
        invoke: element.get_pattern::<UIInvokePattern>().is_ok(),
        toggle: element.get_pattern::<UITogglePattern>().is_ok(),
        legacy_accessible: element.get_pattern::<UILegacyIAccessiblePattern>().is_ok(),
        expand_collapse: element.get_pattern::<UIExpandCollapsePattern>().is_ok(),
        selection_item: element.get_pattern::<UISelectionItemPattern>().is_ok(),
        scroll_item: element.get_pattern::<UIScrollItemPattern>().is_ok(),
    }
}

/// Runs `action` through its pattern. `Press` is oh-my-pi's chain: Invoke,
/// else Toggle, else `LegacyIAccessible` `DoDefaultAction`.
pub(super) fn perform(element: &UIElement, action: UiaAction) -> CoreResult<()> {
    match action {
        UiaAction::Press => {
            if let Ok(pattern) = element.get_pattern::<UIInvokePattern>() {
                return pattern.invoke().map_err(uia_error);
            }
            if let Ok(pattern) = element.get_pattern::<UITogglePattern>() {
                return pattern.toggle().map_err(uia_error);
            }
            element
                .get_pattern::<UILegacyIAccessiblePattern>()
                .and_then(|pattern| pattern.do_default_action())
                .map_err(uia_error)
        }
        UiaAction::Invoke => element
            .get_pattern::<UIInvokePattern>()
            .and_then(|pattern| pattern.invoke())
            .map_err(uia_error),
        UiaAction::Toggle => element
            .get_pattern::<UITogglePattern>()
            .and_then(|pattern| pattern.toggle())
            .map_err(uia_error),
        UiaAction::Expand => element
            .get_pattern::<UIExpandCollapsePattern>()
            .and_then(|pattern| pattern.expand())
            .map_err(uia_error),
        UiaAction::Collapse => element
            .get_pattern::<UIExpandCollapsePattern>()
            .and_then(|pattern| pattern.collapse())
            .map_err(uia_error),
        UiaAction::Select => element
            .get_pattern::<UISelectionItemPattern>()
            .and_then(|pattern| pattern.select())
            .map_err(uia_error),
        UiaAction::ScrollIntoView => element
            .get_pattern::<UIScrollItemPattern>()
            .and_then(|pattern| pattern.scroll_into_view())
            .map_err(uia_error),
    }
}

/// The non-empty value from `Value`, else from `LegacyIAccessible`.
pub(super) fn value(element: &UIElement) -> Option<String> {
    element
        .get_pattern::<UIValuePattern>()
        .and_then(|pattern| pattern.get_value())
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            element
                .get_pattern::<UILegacyIAccessiblePattern>()
                .and_then(|pattern| pattern.get_value())
                .ok()
                .filter(|value| !value.is_empty())
        })
}

pub(super) fn set_value(element: &UIElement, value: &str) -> CoreResult<()> {
    element
        .get_pattern::<UIValuePattern>()
        .and_then(|pattern| pattern.set_value(value))
        .map_err(uia_error)
}
