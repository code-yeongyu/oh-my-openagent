//! AX text insertion decisions and the exact read-back verdict (oh-my-pi
//! 0838d2ab44 ax.rs tests), plus the write reply mapping of this port.

use objc2_application_services::AXError;
use senpi_desktop_core::error::ErrorCode;

use super::text_input::{insertion_result, secure_subrole, takes_inserted_text, text_readback, Subrole, TextSurface};

#[test]
fn rewritten_readback_fails_and_names_what_the_field_reads() {
    let error = text_readback("555-789-0123", "555-789-0123", Some("(555) 789-0123"), false).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(error.message.contains(r#""555-789-0123""#), "{}", error.message);
    assert!(error.message.contains(r#""(555) 789-0123""#), "{}", error.message);
    assert!(text_readback("555-789-0123", "555-789-0123", Some("555-789-0123"), false).is_ok());
}

#[test]
fn inserted_readback_names_the_whole_value_it_expected() {
    let error = text_readback("b", "abc", Some("ac"), false).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    for quoted in [r#""b""#, r#""ac""#, r#""abc""#] {
        assert!(error.message.contains(quoted), "{quoted}: {}", error.message);
    }
    // A value that cannot be read back after an accepted write is an unknown
    // outcome, not a failure.
    let unread = text_readback("b", "abc", None, false).unwrap_err();
    assert_eq!(unread.code, ErrorCode::AxUnconfirmed);
    assert!(unread.message.contains(r#""b""#), "{}", unread.message);
}

#[test]
fn long_readbacks_are_cut() {
    let long = "x".repeat(500);
    let error = text_readback("y", "y", Some(&long), false).unwrap_err();
    assert!(error.message.len() < 400, "{}", error.message.len());
    assert!(error.message.contains('\u{2026}'), "{}", error.message);
}

#[test]
fn secure_readbacks_never_quote_the_text() {
    for actual in [None, Some("\u{2022}\u{2022}\u{2022}\u{2022}"), Some("")] {
        let error = text_readback("hunter2", "sk-hunter2", actual, true).unwrap_err();
        assert!(!error.message.contains("hunter2"), "{}", error.message);
        assert!(error.message.contains("secure"), "{}", error.message);
        let expected = if actual.is_none() { ErrorCode::AxUnconfirmed } else { ErrorCode::AxFailed };
        assert_eq!(error.code, expected, "{actual:?}");
    }
    assert!(text_readback("hunter2", "hunter2", Some("hunter2"), true).is_ok());
}

#[test]
fn an_unreadable_or_malformed_subrole_counts_as_secure() {
    assert!(secure_subrole(Ok(Subrole::Named("AXSecureTextField".to_owned()))));
    assert!(!secure_subrole(Ok(Subrole::Named("AXSearchField".to_owned()))));
    assert!(secure_subrole(Ok(Subrole::Malformed)));
    assert!(!secure_subrole(Ok(Subrole::Absent)));
    assert!(!secure_subrole(Err(AXError::NoValue)));
    assert!(!secure_subrole(Err(AXError::AttributeUnsupported)));
    assert!(secure_subrole(Err(AXError::CannotComplete)));
}

#[test]
fn only_a_settable_native_text_field_takes_inserted_text() {
    let settable = || true;
    for role in ["AXTextField", "AXTextArea", "AXComboBox"] {
        assert!(takes_inserted_text(|| TextSurface::Native, Some(role), settable), "{role}");
    }
    // A web field can echo a write its renderer never accepted.
    assert!(!takes_inserted_text(|| TextSurface::Web, Some("AXTextField"), settable));
    assert!(!takes_inserted_text(|| TextSurface::Unknown, Some("AXTextArea"), settable));
    assert!(!takes_inserted_text(|| TextSurface::Native, Some("AXTextField"), || false));
    assert!(!takes_inserted_text(|| TextSurface::Native, Some("AXButton"), settable));
    assert!(!takes_inserted_text(|| TextSurface::Native, None, settable));
}

#[test]
fn an_unanswered_insertion_write_is_unconfirmed_and_a_destroyed_field_is_stale() {
    let code = |error| insertion_result(error).unwrap_err().code;
    assert!(insertion_result(AXError::Success).is_ok());
    assert_eq!(code(AXError::CannotComplete), ErrorCode::AxUnconfirmed);
    assert_eq!(code(AXError::InvalidUIElement), ErrorCode::StaleRef);
    let refused = insertion_result(AXError::AttributeUnsupported).unwrap_err();
    assert_eq!(refused.code, ErrorCode::AxFailed);
    assert!(refused.message.contains("do not blindly repeat"), "{}", refused.message);
}
