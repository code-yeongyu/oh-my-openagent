use std::cell::Cell;

use senpi_desktop_core::error::{DesktopError, ErrorCode};

use super::run_text_steps;
use crate::delivery::TextUnit;

#[test]
fn mixed_newlines_send_one_enter_and_count_consumed_scalars() {
    let text = "a\r\nb\n\r\u{1f642}";
    let mut sent = Vec::new();
    let mut delivered = 0;
    run_text_steps(
        text,
        &|| Ok(()),
        |unit| {
            sent.push(unit);
            Ok(())
        },
        &mut || delivered += 1,
    )
    .unwrap();

    assert_eq!(
        sent,
        [
            TextUnit::Char('a'),
            TextUnit::Enter,
            TextUnit::Char('b'),
            TextUnit::Enter,
            TextUnit::Enter,
            TextUnit::Char('\u{1f642}'),
        ]
    );
    assert_eq!(delivered, text.chars().count());
}

#[test]
fn stop_after_crlf_preserves_the_delivered_prefix() {
    let delivered = Cell::new(0);
    let mut sent = Vec::new();
    let error = run_text_steps(
        "a\r\nb",
        &|| {
            if delivered.get() == 3 {
                Err(DesktopError::new(ErrorCode::Suspended, "test stop"))
            } else {
                Ok(())
            }
        },
        |unit| {
            sent.push(unit);
            Ok(())
        },
        &mut || delivered.set(delivered.get() + 1),
    )
    .unwrap_err();

    assert_eq!(error.code, ErrorCode::Suspended);
    assert_eq!(sent, [TextUnit::Char('a'), TextUnit::Enter]);
    assert_eq!(delivered.get(), 3);
}

#[test]
fn failed_enter_does_not_count_either_crlf_scalar() {
    let mut delivered = 0;
    let error = run_text_steps(
        "a\r\nb",
        &|| Ok(()),
        |unit| match unit {
            TextUnit::Char(_) => Ok(()),
            TextUnit::Enter => Err(DesktopError::input_failed("test failure")),
        },
        &mut || delivered += 1,
    )
    .unwrap_err();

    assert_eq!(error.code, ErrorCode::InputFailed);
    assert_eq!(delivered, 1);
}

#[test]
fn cancellation_before_delivery_sends_nothing() {
    let mut sent = Vec::new();
    let mut delivered = 0;
    let error = run_text_steps(
        "text",
        &|| Err(DesktopError::new(ErrorCode::Cancelled, "test cancellation")),
        |unit| {
            sent.push(unit);
            Ok(())
        },
        &mut || delivered += 1,
    )
    .unwrap_err();

    assert_eq!(error.code, ErrorCode::Cancelled);
    assert!(sent.is_empty());
    assert_eq!(delivered, 0);
}
