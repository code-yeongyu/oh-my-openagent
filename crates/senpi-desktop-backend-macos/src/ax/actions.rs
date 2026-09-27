//! AX mutations: named actions, `AXValue` writes, and focus.

use objc2_application_services::AXUIElement;
use objc2_core_foundation::{CFBoolean, CFString};
use senpi_desktop_core::error::CoreResult;

use super::element::ax_result;

pub(crate) fn perform(element: &AXUIElement, action: &str) -> CoreResult<()> {
    let native = action_name(action);
    let action = CFString::from_str(&native);
    // SAFETY: The retained element and action CFString stay valid for the
    // synchronous AX request.
    let error = unsafe { element.perform_action(&action) };
    ax_result(error, format!("AX action '{native}' failed"))
}

pub(super) fn set_value(element: &AXUIElement, value: &str) -> CoreResult<()> {
    let attribute = CFString::from_str("AXValue");
    let value = CFString::from_str(value);
    // SAFETY: The element, attribute, and value stay retained for the
    // synchronous setter call.
    let error = unsafe { element.set_attribute_value(&attribute, &value) };
    ax_result(error, "AXValue is not settable; no typing fallback was attempted")
}

pub(super) fn focus(element: &AXUIElement) -> CoreResult<()> {
    let attribute = CFString::from_str("AXFocused");
    // SAFETY: The singleton CFBoolean and retained element stay valid for the
    // synchronous setter call.
    let error = unsafe { element.set_attribute_value(&attribute, CFBoolean::new(true)) };
    ax_result(error, "setting AXFocused=true failed")
}

/// Sets `AXMain` and `AXFocused` to true on a window element: the restore and
/// foreground-preparation half of focus handling.
pub(crate) fn set_window_main_and_focused(element: &AXUIElement) -> CoreResult<()> {
    for attribute in ["AXMain", "AXFocused"] {
        let name = CFString::from_str(attribute);
        // SAFETY: The singleton CFBoolean and retained element stay valid for
        // the synchronous setter call.
        let error = unsafe { element.set_attribute_value(&name, CFBoolean::new(true)) };
        ax_result(error, format!("setting {attribute}=true failed"))?;
    }
    Ok(())
}

/// Model-facing action names (`press`, `show_menu`) -> native `AX*` names.
pub(super) fn action_name(action: &str) -> String {
    match action.trim().to_ascii_lowercase().as_str() {
        "press" => "AXPress".to_string(),
        "raise" => "AXRaise".to_string(),
        "showmenu" | "show_menu" => "AXShowMenu".to_string(),
        _ if action.starts_with("AX") => action.to_string(),
        _ => format!("AX{action}"),
    }
}
