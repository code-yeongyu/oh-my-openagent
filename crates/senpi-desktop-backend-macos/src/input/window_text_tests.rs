//! Background text for a window goes in by AX insertion before any key, as
//! omp 18.13.1 delivers it (`macos/input.rs` `window_type`, `inserts_first`):
//! W1b E-7, where keys let TextEdit capitalize "parity e7" into "Parity e7".

use std::cell::RefCell;

use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::protocol_results::AxInputMethod;

use super::window_text::{background_window_text, is_terminal_bundle};

/// Runs [`background_window_text`] with an insertion that answers `inserted`
/// and keys that report one delivery per character, recording each step.
fn deliver(text: &str, inserted: Result<bool, DesktopError>) -> (Result<AxInputMethod, DesktopError>, Vec<&'static str>, usize) {
    let steps = RefCell::new(Vec::new());
    let mut delivered = 0;
    let result = background_window_text(
        text,
        || {
            steps.borrow_mut().push("insert");
            inserted
        },
        |delivered| {
            steps.borrow_mut().push("keys");
            text.chars().for_each(|_| delivered());
            Ok(())
        },
        &mut || delivered += 1,
    );
    (result, steps.into_inner(), delivered)
}

#[test]
fn a_native_field_takes_the_text_by_insertion_and_no_key_is_sent() {
    let (method, steps, delivered) = deliver("parity e7", Ok(true));
    assert_eq!(steps, ["insert"]);
    assert_eq!(method.unwrap(), AxInputMethod::Inserted);
    assert_eq!(delivered, "parity e7".chars().count());
}

#[test]
fn keys_follow_only_when_no_write_was_attempted() {
    let (method, steps, delivered) = deliver("parity e7", Ok(false));
    assert_eq!(steps, ["insert", "keys"]);
    assert_eq!(method.unwrap(), AxInputMethod::Keys);
    assert_eq!(delivered, 9);
    // An attempted write never falls through to keys: it may be partial.
    let (failed, steps, delivered) = deliver("parity e7", Err(DesktopError::ax_failed("read back differs")));
    assert_eq!(steps, ["insert"]);
    assert_eq!(failed.unwrap_err().code, ErrorCode::AxFailed);
    assert_eq!(delivered, 0);
}

#[test]
fn a_terminal_takes_keys_never_an_insertion() {
    assert!(is_terminal_bundle("com.apple.Terminal"));
    assert!(is_terminal_bundle("com.mitchellh.ghostty"));
    assert!(!is_terminal_bundle("com.apple.TextEdit"));
}

#[test]
fn empty_text_sends_nothing() {
    // An empty `AXSelectedText` write deletes the field's selection, and no
    // key window is needed for nothing.
    let (method, steps, delivered) = deliver("", Ok(true));
    assert!(steps.is_empty());
    assert_eq!(method.unwrap(), AxInputMethod::Inserted);
    assert_eq!(delivered, 0);
}
