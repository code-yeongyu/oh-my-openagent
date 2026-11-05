//! Where keys go from what an application reports (oh-my-pi 18.13.1
//! `macos/ax.rs` key-focus tests).

use objc2_application_services::AXError;

use super::{focused_window, FocusedWindow, KeyDestination, KeyFocus};

const TARGET: u32 = 10;
const SIBLING: u32 = 11;
const OVERLAY: u32 = 12;

/// `OVERLAY` is attached to `TARGET`; nothing else has a parent.
fn parent_of(id: u32) -> Option<u32> {
    (id == OVERLAY).then_some(TARGET)
}

fn focus(window: FocusedWindow, element_window: Option<u32>) -> KeyFocus {
    KeyFocus { window, element_window }
}

#[test]
fn the_reported_focused_window_decides_where_keys_go() {
    assert_eq!(focus(FocusedWindow::Id(TARGET), None).destination(TARGET, parent_of), KeyDestination::Target);
    assert_eq!(
        focus(FocusedWindow::Id(SIBLING), Some(SIBLING)).destination(TARGET, parent_of),
        KeyDestination::Other(Some(SIBLING)),
    );
    assert_eq!(focus(FocusedWindow::Unmapped, None).destination(TARGET, parent_of), KeyDestination::Other(None));
    assert_eq!(focus(FocusedWindow::Unreadable, None).destination(TARGET, parent_of), KeyDestination::Other(None));
}

#[test]
fn a_focused_sheet_attached_to_the_target_is_another_window() {
    // Given: the app reports the sheet attached to the target as focused
    let sheet = focus(FocusedWindow::Id(OVERLAY), Some(OVERLAY));
    // When / Then: keys would land in the sheet, not the target
    assert_eq!(sheet.destination(TARGET, parent_of), KeyDestination::Other(Some(OVERLAY)));
}

#[test]
fn an_unreported_window_follows_the_focused_element_and_its_overlay() {
    // Given: Finder reports no focused window while its rename overlay holds focus
    let rename = focus(FocusedWindow::Unreported, Some(OVERLAY));
    // Then
    assert_eq!(rename.destination(TARGET, parent_of), KeyDestination::Target);
    assert!(rename.in_overlay_of(TARGET, parent_of));
    assert_eq!(focus(FocusedWindow::Unreported, Some(TARGET)).destination(TARGET, parent_of), KeyDestination::Target);
    assert_eq!(
        focus(FocusedWindow::Unreported, Some(SIBLING)).destination(TARGET, parent_of),
        KeyDestination::Unreported,
    );
    assert!(!focus(FocusedWindow::Id(TARGET), Some(TARGET)).in_overlay_of(TARGET, parent_of));
}

#[test]
fn a_popover_field_reaches_the_popover_while_its_parent_is_reported() {
    // Given: the app reports the parent window while the field is in its popover
    let popover = focus(FocusedWindow::Id(TARGET), Some(OVERLAY));
    // Then: keys for the popover reach it, and the focus counts as in an overlay
    assert_eq!(popover.destination(OVERLAY, parent_of), KeyDestination::Target);
    assert!(popover.in_overlay_of(OVERLAY, parent_of));
}

#[test]
fn inserted_text_lands_only_in_a_field_of_the_target() {
    // E-7: doc2's text area holds TextEdit's focus while Notes is in front.
    assert!(focus(FocusedWindow::Id(TARGET), Some(TARGET)).holds_text_for(TARGET, parent_of));
    assert!(focus(FocusedWindow::Unreported, Some(TARGET)).holds_text_for(TARGET, parent_of));
    // A field in another window of the app is never written for the target.
    assert!(!focus(FocusedWindow::Id(SIBLING), Some(SIBLING)).holds_text_for(TARGET, parent_of));
    assert!(!focus(FocusedWindow::Unreadable, Some(SIBLING)).holds_text_for(TARGET, parent_of));
    // A field in a sheet attached to the target belongs to the sheet.
    assert!(!focus(FocusedWindow::Id(OVERLAY), Some(OVERLAY)).holds_text_for(TARGET, parent_of));
}

#[test]
fn only_a_no_value_answer_means_no_focused_window() {
    let id_of = |id: &u32| Some(*id);
    assert_eq!(focused_window(Ok(Some(TARGET)), id_of), FocusedWindow::Id(TARGET));
    assert_eq!(focused_window(Ok(Some(TARGET)), |_| None), FocusedWindow::Unmapped);
    assert_eq!(focused_window::<u32>(Ok(None), id_of), FocusedWindow::Unreported);
    assert_eq!(focused_window::<u32>(Err(AXError::NoValue), id_of), FocusedWindow::Unreported);
    assert_eq!(focused_window::<u32>(Err(AXError::CannotComplete), id_of), FocusedWindow::Unreadable);
}
