//! AX mutations: named actions, `AXValue` writes, and focus. The model's
//! requests ([`perform_requested`], [`set_value`], [`focus`]) are background
//! calls under [`reporting_partial`] and run the press check before they write;
//! an action or an `AXValue` write the app accepted or left unanswered marks the
//! call sent. An `AXFocused` write does not: it only prepares later input.

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFBoolean, CFDate, CFString, CFTimeZone, CFType};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::intervention::check_press;

use super::date;
use super::element::{self, ax_result, copy_date, element_pid};
use super::popup;
use super::replace_value::{may_borrow_focus, replace_native_text};
use super::text_input::{ensure_native_text_target, is_secure, text_readback};
use crate::skylight::{mark_sent, reporting_partial};

pub(crate) fn perform(element: &AXUIElement, action: &str) -> CoreResult<()> {
    let native = action_name(action);
    let action = CFString::from_str(&native);
    // SAFETY: The retained element and action CFString stay valid for the
    // synchronous AX request.
    let error = sent(unsafe { element.perform_action(&action) });
    ax_result(error, format!("AX action '{native}' failed"))
}

/// Marks the call sent when the app accepted the request or never answered
/// it: either way it may have taken effect. A refusal changed nothing.
fn sent(error: AXError) -> AXError {
    if error == AXError::Success || error == AXError::CannotComplete {
        mark_sent();
    }
    error
}

/// The AX requests an element write sends, each answered by the app's
/// `AXError` reply: the seam tests script replies through.
pub(super) trait AxRequests {
    fn send_action(&self, action: &CFString) -> AXError;
    fn write_attribute(&self, attribute: &CFString, value: &CFType) -> AXError;
    fn read_date(&self, attribute: &str) -> Option<f64>;
}

impl AxRequests for AXUIElement {
    fn send_action(&self, action: &CFString) -> AXError {
        // SAFETY: The retained element and action CFString stay valid for the
        // synchronous AX request.
        unsafe { self.perform_action(action) }
    }

    fn write_attribute(&self, attribute: &CFString, value: &CFType) -> AXError {
        // SAFETY: The element, attribute, and value stay retained for the
        // synchronous setter call.
        unsafe { self.set_attribute_value(attribute, value) }
    }

    fn read_date(&self, attribute: &str) -> Option<f64> {
        copy_date(self, attribute)
    }
}

/// The outcome of a model-requested AX write, from the app's reply.
/// `CannotComplete` means messaging failed or the app did not reply in time,
/// e.g. while the request runs a modal dialog: the request was made, so its
/// outcome is unknown rather than failed (`AxUnconfirmed`, ported from
/// oh-my-pi `element_action_result`). Every other reply keeps the
/// [`ax_result`] mapping.
pub(super) fn request_result(error: AXError, request: &str, failed: impl Into<String>) -> CoreResult<()> {
    if error == AXError::CannotComplete {
        return Err(DesktopError::ax_unconfirmed(format!(
            "{request} was requested, but its outcome could not be confirmed: the app did not reply \
             in time or messaging failed ({error:?}), for example because it opened a modal \
             dialog. It may already have taken effect: observe the window before retrying"
        )));
    }
    ax_result(error, failed)
}

/// Performs a model-requested action (`ax.perform`, presses): a request the
/// app got but did not answer is `AxUnconfirmed`.
pub(super) fn perform_requested(element: &(impl AxRequests + ?Sized), action: &str) -> CoreResult<()> {
    reporting_partial(|| {
        check_press()?;
        let native = action_name(action);
        let error = sent(element.send_action(&CFString::from_str(&native)));
        request_result(error, &format!("AX action '{native}'"), format!("AX action '{native}' failed"))
    })
}

/// `ax.setValue`: a popup's value is chosen from its menu; otherwise the
/// element must be a verifiable native text target with a settable `AXValue`.
/// A date control takes a `CFDate`. A native text field is replaced through
/// `AXSelectedText` over its whole value ([`replace_native_text`]: several
/// apps echo an `AXValue` write without ever taking it); anything else takes
/// the `AXValue` write, read back exactly ([`text_readback`]).
pub(super) fn set_value(element: &AXUIElement, value: &str) -> CoreResult<()> {
    reporting_partial(|| {
        if element::copy_string(element, "AXRole").as_deref() == Some("AXPopUpButton") {
            return popup::choose(element, value);
        }
        ensure_native_text_target(element)?;
        if !element::attribute_settable(element, "AXValue") {
            return Err(DesktopError::ax_failed("AXValue is not settable; no typing fallback was attempted"));
        }
        if let Some(current) = element.read_date("AXValue") {
            return set_date_value(element, value, current);
        }
        let pid = element_pid(element)?;
        // Focus is borrowed only from an app already in the background as the
        // call starts: in the front app it would move the user's caret.
        let started_in_background = may_borrow_focus(crate::front_app::current_front_pid(), pid);
        if replace_native_text(element, pid, started_in_background, value)? {
            return Ok(());
        }
        // A control whose value is not text (a slider, stepper or checkbox)
        // cannot be read back as the string that was written.
        let textual = element::copy_string(element, "AXValue").is_some();
        set_string_value(element, value)?;
        if !textual {
            return Ok(());
        }
        text_readback(value, value, element::copy_string(element, "AXValue").as_deref(), is_secure(element))
    })
}

pub(super) fn set_string_value(element: &(impl AxRequests + ?Sized), value: &str) -> CoreResult<()> {
    check_press()?;
    let value = CFString::from_str(value);
    let error = sent(element.write_attribute(&CFString::from_str("AXValue"), &value));
    request_result(
        error,
        "setting AXValue",
        "AXValue is not settable; no typing fallback was attempted",
    )
}

/// Date and time controls publish `AXValue` as a `CFDate` and refuse the same
/// date written as a `CFString`, so an ISO-8601 value is written as a `CFDate`
/// in the system time zone the control displays, then read back as one.
pub(super) fn set_date_value(element: &(impl AxRequests + ?Sized), text: &str, current: f64) -> CoreResult<()> {
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
    check_press()?;
    let error = sent(element.write_attribute(&CFString::from_str("AXValue"), &value));
    // An unanswered write is never read back: the control may still change.
    request_result(error, "setting AXValue to a date", "setting AXValue to a date failed")?;
    match element.read_date("AXValue") {
        Some(actual) if (actual - target).abs() < 1e-3 => Ok(()),
        actual => Err(DesktopError::ax_failed(format!(
            "AX accepted the date write but the control reads {} instead of {}",
            actual.map_or_else(|| "no date".to_owned(), |at| date::format_local(at, offset_at)),
            date::format_local(target, offset_at),
        ))),
    }
}

pub(super) fn focus(element: &(impl AxRequests + ?Sized)) -> CoreResult<()> {
    reporting_partial(|| {
        check_press()?;
        let error = element.write_attribute(&CFString::from_str("AXFocused"), CFBoolean::new(true));
        request_result(error, "setting AXFocused=true", "setting AXFocused=true failed")
    })
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

#[cfg(test)]
#[path = "actions_tests.rs"]
mod tests;
