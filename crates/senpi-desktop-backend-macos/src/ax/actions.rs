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
use super::element::action_names;
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
    /// The actions the element lists (`AXActionNames`), or why it could not answer.
    fn action_names(&self) -> Result<Vec<String>, AXError>;
    fn send_action(&self, action: &CFString) -> AXError;
    fn write_attribute(&self, attribute: &CFString, value: &CFType) -> AXError;
    fn read_date(&self, attribute: &str) -> Option<f64>;
}

impl AxRequests for AXUIElement {
    fn action_names(&self) -> Result<Vec<String>, AXError> {
        action_names(self)
    }

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

/// The action that scrolls an element into its view.
const SCROLL_TO_VISIBLE: &str = "AXScrollToVisible";

/// Performs a model-requested action (`ax.perform`, presses): an action the
/// element does not list is refused with nothing sent (a press points at
/// `click()`); a `UIKit` press scrolls the element into view first
/// ([`scrolls_before_press`]); a request the app got but did not answer is
/// `AxUnconfirmed`. `uikit` classifies the element's app, read only when a
/// press could scroll.
pub(super) fn perform_requested(
    element: &(impl AxRequests + ?Sized),
    action: &str,
    uikit: impl FnOnce() -> bool,
) -> CoreResult<()> {
    reporting_partial(|| {
        check_press()?;
        let native = action_name(action);
        // A destroyed element or an app that does not answer is its own
        // refusal, not an element with no actions.
        let actions = element.action_names().map_err(|error| {
            DesktopError::ax_failed(format!(
                "the element's actions could not be read ({error:?}), so the press was not sent; nothing was sent"
            ))
        })?;
        if !actions.contains(&native) {
            return Err(unsupported_action(&native, &actions));
        }
        if scrolls_before_press(&native, &actions, uikit) {
            // A failed scroll leaves the press to report its own outcome.
            let _ = element.send_action(&CFString::from_str(SCROLL_TO_VISIBLE));
        }
        let error = sent(element.send_action(&CFString::from_str(&native)));
        request_result(error, &format!("AX action '{native}'"), format!("AX action '{native}' failed"))
    })
}

/// The refusal of `native`, an action the element does not list among
/// `actions`; nothing was sent. A control without a press action still takes
/// a click (ported from oh-my-pi 0838d2ab44 `unsupported_action`).
pub(super) fn unsupported_action(native: &str, actions: &[String]) -> DesktopError {
    let instead = if native == "AXPress" {
        "; nothing was sent: if this is the control you meant, click() it instead"
    } else {
        ""
    };
    DesktopError::ax_failed(format!(
        "AX action '{native}' is not supported by this element; available actions: {}{instead}",
        actions.join(", "),
    ))
}

/// `UIKit` (Mac Catalyst, iPhone and iPad apps) answers `AXPress` by tapping
/// the element where it is drawn, so pressing a row scrolled out of its view
/// reports success and does nothing. Scrolling it into view first lets the
/// tap land; for an element already in view the scroll changes nothing
/// (ported from oh-my-pi 0838d2ab44 `scrolls_before_press`).
pub(super) fn scrolls_before_press(native: &str, actions: &[String], uikit: impl FnOnce() -> bool) -> bool {
    native == "AXPress" && actions.iter().any(|action| action == SCROLL_TO_VISIBLE) && uikit()
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
        let textual = element::copy_string(element, "AXValue").is_some();
        set_string_value(element, value)?;
        value_readback(value, textual, element::copy_string(element, "AXValue").as_deref(), is_secure(element))
    })
}

/// The read-back after an `AXValue` write: a control whose value was not
/// text before the write (a slider, stepper or checkbox) and still is not
/// cannot be read back as the string that was written; one that reads as a
/// string now, even if it read as none before (some empty fields report no
/// value), must read back exactly.
pub(super) fn value_readback(sent: &str, textual_before: bool, after: Option<&str>, secure: bool) -> CoreResult<()> {
    if !textual_before && after.is_none() {
        return Ok(());
    }
    text_readback(sent, sent, after, secure)
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
