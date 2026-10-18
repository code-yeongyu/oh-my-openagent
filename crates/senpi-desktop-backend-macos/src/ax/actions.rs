//! AX mutations: named actions, `AXValue` writes, and focus.

use objc2_application_services::AXUIElement;
use objc2_core_foundation::{CFBoolean, CFDate, CFString, CFTimeZone};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::date;
use super::element::{self, ax_result, copy_date};
use super::popup;

pub(crate) fn perform(element: &AXUIElement, action: &str) -> CoreResult<()> {
    let native = action_name(action);
    let action = CFString::from_str(&native);
    // SAFETY: The retained element and action CFString stay valid for the
    // synchronous AX request.
    let error = unsafe { element.perform_action(&action) };
    ax_result(error, format!("AX action '{native}' failed"))
}

pub(super) fn set_value(element: &AXUIElement, value: &str) -> CoreResult<()> {
    if element::copy_string(element, "AXRole").as_deref() == Some("AXPopUpButton") {
        return popup::choose(element, value);
    }
    match copy_date(element, "AXValue") {
        Some(current) => set_date_value(element, value, current),
        None => set_string_value(element, value),
    }
}

fn set_string_value(element: &AXUIElement, value: &str) -> CoreResult<()> {
    let attribute = CFString::from_str("AXValue");
    let value = CFString::from_str(value);
    // SAFETY: The element, attribute, and value stay retained for the
    // synchronous setter call.
    let error = unsafe { element.set_attribute_value(&attribute, &value) };
    ax_result(error, "AXValue is not settable; no typing fallback was attempted")
}

/// Date and time controls publish `AXValue` as a `CFDate` and refuse the same
/// date written as a `CFString`, so an ISO-8601 value is written as a `CFDate`
/// in the system time zone the control displays, then read back as one.
fn set_date_value(element: &AXUIElement, text: &str, current: f64) -> CoreResult<()> {
    // CF caches the system zone per process; the target app follows changes to it.
    CFTimeZone::reset_system();
    let zone = CFTimeZone::system().ok_or_else(|| DesktopError::ax_failed("the system time zone is unavailable"))?;
    let offset_at = |at: f64| zone.seconds_from_gmt(at) as i64;
    let Some(request) = date::parse(text) else {
        return Err(DesktopError::ax_failed(format!(
            "AXValue is a date and {text:?} is not ISO-8601: write {}; it reads {} now; nothing was \
             written",
            date::ACCEPTED_FORMS,
            date::format_local(current, offset_at),
        )));
    };
    let target = request
        .absolute_time(current, offset_at)
        .map_err(|reason| DesktopError::ax_failed(format!("{reason}; nothing was written")))?;
    let value =
        CFDate::new(None, target).ok_or_else(|| DesktopError::ax_failed("creating the CFDate to write failed"))?;
    let attribute = CFString::from_str("AXValue");
    // SAFETY: The element, attribute, and date stay retained for the
    // synchronous setter call.
    let error = unsafe { element.set_attribute_value(&attribute, &value) };
    ax_result(error, "setting AXValue to a date failed")?;
    match copy_date(element, "AXValue") {
        Some(actual) if (actual - target).abs() < 1e-3 => Ok(()),
        actual => Err(DesktopError::ax_failed(format!(
            "AX accepted the date write but the control reads {} instead of {}",
            actual.map_or_else(|| "no date".to_owned(), |at| date::format_local(at, offset_at)),
            date::format_local(target, offset_at),
        ))),
    }
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

/// Writes a boolean attribute.
pub(crate) fn set_bool(element: &AXUIElement, attribute: &str, value: bool) -> CoreResult<()> {
    let name = CFString::from_str(attribute);
    // SAFETY: The singleton CFBoolean and retained element stay valid for the
    // synchronous setter call.
    let error = unsafe { element.set_attribute_value(&name, CFBoolean::new(value)) };
    ax_result(error, format!("setting {attribute}={value} failed"))
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
