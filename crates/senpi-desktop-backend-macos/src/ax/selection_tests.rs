//! The selection write's verdict and settle (oh-my-pi 0838d2ab44
//! ax/selection.rs tests), over injected reads and writes.

use std::cell::Cell;
use std::time::Duration;

use objc2_application_services::AXError;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::intervention::{check_press, watch};
use senpi_desktop_core::text_range::Utf16Range;

use super::selection::{apply, write_result};

const VALUE: &str = "alpha beta gamma";
const WANTED: Utf16Range = Utf16Range { start: 6, length: 4 };

/// Runs `apply` with a guard that marks when its own post-action settle has
/// finished, and a selection read that `range` answers from the number of
/// reads so far and whether the guard is done.
fn run(range: impl Fn(usize, bool) -> Option<Utf16Range>, value: &str) -> CoreResult<Utf16Range> {
    let settled = Cell::new(false);
    let reads = Cell::new(0);
    let writes = Cell::new(0);
    let result = apply(
        VALUE,
        WANTED,
        |action| {
            let result = action();
            settled.set(true);
            result
        },
        || false,
        || {
            writes.set(writes.get() + 1);
            Ok(())
        },
        || {
            reads.set(reads.get() + 1);
            range(reads.get(), settled.get())
        },
        || Some(value.to_owned()),
        Duration::from_millis(200),
    );
    assert_eq!(writes.get(), 1, "the selection is written exactly once");
    result
}

#[test]
fn a_selection_write_without_a_reply_is_unconfirmed_not_failed() {
    assert!(write_result(AXError::Success).is_ok());
    let error = write_result(AXError::CannotComplete).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxUnconfirmed, "{error}");
    assert!(error.message.contains("inspect the element"), "{error}");
    let error = write_result(AXError::IllegalArgument).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed, "{error}");
    assert!(error.message.contains("nothing was selected"), "{error}");
    assert_eq!(write_result(AXError::InvalidUIElement).unwrap_err().code, ErrorCode::StaleRef);
}

#[test]
fn a_selection_that_settles_after_the_write_is_confirmed() {
    let lagging = |reads: usize, _| {
        Some(if reads < 3 {
            Utf16Range { start: 16, length: 0 }
        } else {
            WANTED
        })
    };
    assert_eq!(run(lagging, VALUE).unwrap(), WANTED);
}

#[test]
fn a_selection_moved_during_the_guard_settle_is_reported_not_returned() {
    let moved = |_, settled: bool| {
        Some(if settled {
            Utf16Range { start: 0, length: 0 }
        } else {
            WANTED
        })
    };
    let error = run(moved, VALUE).unwrap_err();
    assert!(error.message.contains("reads back 0 length 0"), "{error}");
}

#[test]
fn a_selection_lost_during_the_guard_settle_is_reported() {
    let lost = |_, settled: bool| (!settled).then_some(WANTED);
    let error = run(lost, VALUE).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxUnconfirmed, "{error}");
    assert!(error.message.contains("could not be read back"), "{error}");
}

#[test]
fn a_value_changed_while_selecting_is_reported() {
    let error = run(|_, _| Some(WANTED), "alpha beta gamma!").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(error.message.contains("value changed"), "{error}");
}

/// Runs `apply` with a write that would succeed under the press check
/// `check`, with the front-app read answering `brought_forward`, and returns
/// the outcome and whether the selection was written.
fn checked(check: fn() -> CoreResult<()>, brought_forward: bool) -> (Result<Utf16Range, ErrorCode>, bool) {
    let _watch = watch(check);
    let wrote = Cell::new(false);
    let result = apply(
        VALUE,
        WANTED,
        |action| action(),
        || brought_forward,
        || {
            wrote.set(true);
            Ok(())
        },
        || Some(WANTED),
        || Some(VALUE.to_owned()),
        Duration::ZERO,
    );
    (result.map_err(|error| error.code), wrote.get())
}

fn pass() -> CoreResult<()> {
    Ok(())
}

fn user_typed() -> CoreResult<()> {
    Err(DesktopError::user_intervened("the user typed in the app"))
}

#[test]
fn a_press_check_refusing_before_the_write_selects_nothing() {
    assert_eq!(checked(pass, false), (Ok(WANTED), true));
    // The user types into the app during the probes: the check installed for
    // the request refuses, and the selection is never written.
    assert_eq!(checked(user_typed, false), (Err(ErrorCode::UserIntervened), false));
    assert!(check_press().is_ok(), "the watch is uninstalled after the call");
}

#[test]
fn an_app_brought_forward_during_the_call_keeps_its_caret() {
    assert_eq!(checked(pass, true), (Err(ErrorCode::AxFailed), false));
}
