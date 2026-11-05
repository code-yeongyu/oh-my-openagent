//! Background key routing for multi-window applications (W1 E-1, E-2, E-3,
//! E-4, E-7, E-9; plan todo 9; oh-my-pi 18.13.1 `macos/input.rs` tests).

use senpi_desktop_core::error::ErrorCode;

use super::{key_refusal, key_verdict, keyboard_conflict, keys_still_reach, KeyVerdict, KeyboardConflict};
use crate::ax::key_focus::{AxWindowRecord, FocusedWindow, KeyDestination, KeyFocus};

const TARGET: u32 = 10;
const SIBLING: u32 = 11;
const SHEET: u32 = 12;

fn record(id: u32) -> AxWindowRecord {
    AxWindowRecord {
        id: Some(id),
        minimized: Some(false),
    }
}

/// `SHEET` is attached to `TARGET`.
fn parent_of(id: u32) -> Option<u32> {
    (id == SHEET).then_some(TARGET)
}

fn focused(id: u32) -> KeyFocus {
    KeyFocus {
        window: FocusedWindow::Id(id),
        element_window: Some(id),
    }
}

#[test]
fn a_second_window_does_not_refuse_keys_once_the_target_is_key() {
    // Given: a two-window app (the W1 fixture, TextEdit with two documents)
    let conflict = keyboard_conflict(TARGET, &[record(TARGET), record(SIBLING)], || false);
    assert_eq!(conflict, Some(KeyboardConflict::Siblings(1)));
    // When: the app reports the target as its focused window
    let verdict = key_verdict(focused(TARGET).destination(TARGET, parent_of), conflict);
    // Then: keys go out
    assert_eq!(verdict, KeyVerdict::Deliver);
}

#[test]
fn keys_wait_while_another_window_is_key_or_nothing_proves_the_target() {
    let siblings = Some(KeyboardConflict::Siblings(1));
    assert_eq!(key_verdict(KeyDestination::Other(Some(SIBLING)), None), KeyVerdict::Wait);
    assert_eq!(key_verdict(KeyDestination::Unreported, siblings), KeyVerdict::Wait);
    // A sole window with no focused window reported is the only one keys can reach.
    assert_eq!(key_verdict(KeyDestination::Unreported, None), KeyVerdict::Deliver);
}

#[test]
fn a_minimized_sibling_cannot_take_keys_and_an_unlisted_target_is_unmapped() {
    let minimized = AxWindowRecord {
        id: Some(SIBLING),
        minimized: Some(true),
    };
    assert_eq!(keyboard_conflict(TARGET, &[record(TARGET), minimized], || false), None);
    assert_eq!(keyboard_conflict(TARGET, &[record(SIBLING)], || false), Some(KeyboardConflict::Unmapped));
    assert_eq!(
        keyboard_conflict(SHEET, &[record(TARGET)], || true),
        Some(KeyboardConflict::Siblings(1)),
    );
}

#[test]
fn a_focused_sheet_on_the_target_refuses_and_names_the_sheet() {
    // Given: TextEdit's document has a sheet open, and the sheet holds focus
    let destination = focused(SHEET).destination(TARGET, parent_of);
    // When
    let error = key_refusal(TARGET, destination, Some(KeyboardConflict::Siblings(1)), parent_of);
    // Then: nothing was sent, and the sheet is named as where keys would go
    assert_eq!(error.code, ErrorCode::InvalidTarget, "{error}");
    assert!(error.message.contains(&format!("window {SHEET}")), "{}", error.message);
}

#[test]
fn a_target_that_never_became_key_names_the_window_that_still_is() {
    let error = key_refusal(TARGET, KeyDestination::Other(Some(SIBLING)), None, parent_of);
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable, "{error}");
    assert!(error.message.contains(&format!("window {SIBLING} still is")), "{}", error.message);
}

#[test]
fn focus_moving_to_another_window_mid_type_stops_with_input_failed() {
    // Given: delivery was admitted with the target key
    let proven = focused(TARGET);
    // When: the user or the app makes another window key between presses
    let error = keys_still_reach(TARGET, || None, proven, focused(SIBLING), parent_of).unwrap_err();
    // Then: the next press is not sent, and the earlier ones may have landed
    assert_eq!(error.code, ErrorCode::InputFailed, "{error}");
    assert!(error.message.contains("may already have landed"), "{}", error.message);
    assert!(keys_still_reach(TARGET, || None, proven, focused(TARGET), parent_of).is_ok());
}

#[test]
fn an_overlay_that_closed_mid_type_stops_the_keys() {
    // Given: Finder reported no focused window, its rename overlay held focus
    let rename = KeyFocus {
        window: FocusedWindow::Unreported,
        element_window: Some(SHEET),
    };
    // When: the overlay closes and focus falls back to the window under it
    let fallen = KeyFocus {
        window: FocusedWindow::Unreported,
        element_window: Some(TARGET),
    };
    // Then
    assert!(keys_still_reach(TARGET, || None, rename, rename, parent_of).is_ok());
    let error = keys_still_reach(TARGET, || None, rename, fallen, parent_of).unwrap_err();
    assert_eq!(error.code, ErrorCode::InputFailed, "{error}");
}

#[test]
fn a_window_opened_mid_type_with_no_focus_reported_stops_the_keys() {
    let proven = KeyFocus::default();
    let none = KeyFocus::default();
    assert!(keys_still_reach(TARGET, || None, proven, none, parent_of).is_ok());
    let error = keys_still_reach(TARGET, || Some(KeyboardConflict::Siblings(1)), proven, none, parent_of).unwrap_err();
    assert_eq!(error.code, ErrorCode::InputFailed, "{error}");
}
