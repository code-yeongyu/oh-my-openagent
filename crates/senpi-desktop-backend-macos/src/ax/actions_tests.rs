use std::cell::{Cell, RefCell};

use objc2_application_services::AXError;
use objc2_core_foundation::{CFString, CFType};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use super::{focus, perform_requested, request_result, write_value, AxRequests};
use crate::skylight::reporting_partial;

/// An element that answers every request with `reply` and records what it
/// was asked; `date` is what its `AXValue` reads as a `CFDate`.
struct ScriptedElement {
    reply: AXError,
    date: Option<f64>,
    requests: RefCell<Vec<String>>,
    date_reads: Cell<u32>,
}

impl ScriptedElement {
    fn replying(reply: AXError) -> Self {
        Self {
            reply,
            date: None,
            requests: RefCell::new(Vec::new()),
            date_reads: Cell::new(0),
        }
    }

    fn dated(reply: AXError, date: f64) -> Self {
        Self {
            date: Some(date),
            ..Self::replying(reply)
        }
    }

    fn requests(&self) -> Vec<String> {
        self.requests.borrow().clone()
    }
}

impl AxRequests for ScriptedElement {
    fn send_action(&self, action: &CFString) -> AXError {
        self.requests.borrow_mut().push(format!("perform {action}"));
        self.reply
    }

    fn write_attribute(&self, attribute: &CFString, _value: &CFType) -> AXError {
        self.requests.borrow_mut().push(format!("set {attribute}"));
        self.reply
    }

    fn read_date(&self, _attribute: &str) -> Option<f64> {
        self.date_reads.set(self.date_reads.get() + 1);
        self.date
    }
}

fn assert_unconfirmed(error: &DesktopError, request: &str) {
    assert_eq!(error.code, ErrorCode::AxUnconfirmed, "{error}");
    assert!(error.message.contains(request), "{}", error.message);
    assert!(error.message.contains("could not be confirmed"), "{}", error.message);
    assert!(error.message.contains("before retrying"), "{}", error.message);
}

#[test]
fn only_cannot_complete_reports_the_request_as_unconfirmed() {
    // Given
    let refusals = [
        AXError::Failure,
        AXError::IllegalArgument,
        AXError::InvalidUIElement,
        AXError::AttributeUnsupported,
        AXError::ActionUnsupported,
        AXError::NotImplemented,
        AXError::APIDisabled,
    ];
    // When
    let unconfirmed = request_result(AXError::CannotComplete, "AX action 'AXPress'", "failed").unwrap_err();
    let refused: Vec<ErrorCode> = refusals
        .into_iter()
        .map(|error| request_result(error, "AX action 'AXPress'", "failed").unwrap_err().code)
        .collect();
    // Then
    assert_unconfirmed(&unconfirmed, "AX action 'AXPress'");
    assert_eq!(refused, vec![ErrorCode::AxFailed; refusals.len()]);
    assert!(request_result(AXError::Success, "AX action 'AXPress'", "failed").is_ok());
}

#[test]
fn a_perform_without_a_reply_is_unconfirmed() {
    // Given
    let element = ScriptedElement::replying(AXError::CannotComplete);
    // When
    let error = perform_requested(&element, "press").unwrap_err();
    // Then
    assert_unconfirmed(&error, "AX action 'AXPress'");
    assert_eq!(element.requests(), ["perform AXPress"]);
}

#[test]
fn a_refused_perform_stays_failed() {
    // Given
    let element = ScriptedElement::replying(AXError::IllegalArgument);
    // When
    let error = perform_requested(&element, "AXShowMenu").unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::AxFailed, "{error}");
    assert!(error.message.contains("AX action 'AXShowMenu' failed"), "{}", error.message);
    assert!(perform_requested(&ScriptedElement::replying(AXError::Success), "press").is_ok());
}

#[test]
fn a_value_write_without_a_reply_is_unconfirmed() {
    // Given
    let element = ScriptedElement::replying(AXError::CannotComplete);
    // When
    let error = write_value(&element, "hello").unwrap_err();
    // Then
    assert_unconfirmed(&error, "setting AXValue");
    assert_eq!(element.requests(), ["set AXValue"]);
}

#[test]
fn a_refused_value_write_stays_failed() {
    // Given
    let element = ScriptedElement::replying(AXError::AttributeUnsupported);
    // When
    let error = write_value(&element, "hello").unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::AxFailed, "{error}");
    assert!(error.message.contains("AXValue is not settable"), "{}", error.message);
    assert!(write_value(&ScriptedElement::replying(AXError::Success), "hello").is_ok());
}

#[test]
fn a_date_write_without_a_reply_is_unconfirmed_and_not_read_back() {
    // Given
    let element = ScriptedElement::dated(AXError::CannotComplete, 0.0);
    // When
    let error = write_value(&element, "2026-10-27T12:00:00").unwrap_err();
    // Then
    assert_unconfirmed(&error, "setting AXValue to a date");
    assert_eq!(element.requests(), ["set AXValue"]);
    assert_eq!(element.date_reads.get(), 1, "only the type probe reads the date");
}

#[test]
fn a_date_the_control_answered_but_did_not_take_stays_failed() {
    // Given: the write is answered, yet the control still reads its old date
    let element = ScriptedElement::dated(AXError::Success, 0.0);
    // When
    let error = write_value(&element, "2026-10-27T12:00:00").unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::AxFailed, "{error}");
    assert!(error.message.contains("AX accepted the date write"), "{}", error.message);
    assert_eq!(element.date_reads.get(), 2, "the answered write is read back");
}

#[test]
fn a_focus_write_without_a_reply_is_unconfirmed() {
    // Given
    let element = ScriptedElement::replying(AXError::CannotComplete);
    // When
    let error = focus(&element).unwrap_err();
    // Then
    assert_unconfirmed(&error, "setting AXFocused=true");
    assert_eq!(element.requests(), ["set AXFocused"]);
}

/// The code of a refusal that follows `request` inside one background call.
fn refusal_after(request: impl FnOnce()) -> ErrorCode {
    reporting_partial(|| -> CoreResult<()> {
        request();
        Err(DesktopError::background_unavailable("the next step was refused; nothing was sent"))
    })
    .unwrap_err()
    .code
}

#[test]
fn an_action_or_value_write_that_may_have_landed_marks_the_call_sent() {
    // Given: requests the app took or left unanswered
    let element = ScriptedElement::replying;
    // When
    let refusals = [
        refusal_after(|| assert!(perform_requested(&element(AXError::Success), "press").is_ok())),
        refusal_after(|| assert!(perform_requested(&element(AXError::CannotComplete), "press").is_err())),
        refusal_after(|| assert!(write_value(&element(AXError::Success), "hello").is_ok())),
        refusal_after(|| assert!(write_value(&element(AXError::CannotComplete), "hello").is_err())),
    ];
    // Then: a later refusal may not be rerun as if nothing was sent
    assert_eq!(refusals, [ErrorCode::InputFailed; 4]);
}

#[test]
fn a_refused_request_or_a_focus_write_leaves_the_call_unsent() {
    // Given: requests the app refused, and a focus write that only prepares input
    let element = ScriptedElement::replying;
    // When
    let refusals = [
        refusal_after(|| assert!(perform_requested(&element(AXError::IllegalArgument), "press").is_err())),
        refusal_after(|| assert!(write_value(&element(AXError::AttributeUnsupported), "hello").is_err())),
        refusal_after(|| assert!(focus(&element(AXError::Success)).is_ok())),
    ];
    // Then
    assert_eq!(refusals, [ErrorCode::BackgroundUnavailable; 3]);
}

#[test]
fn a_refused_focus_write_stays_failed() {
    // Given
    let element = ScriptedElement::replying(AXError::IllegalArgument);
    // When
    let error = focus(&element).unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::AxFailed, "{error}");
    assert!(error.message.contains("setting AXFocused=true failed"), "{}", error.message);
    assert!(focus(&ScriptedElement::replying(AXError::Success)).is_ok());
}
