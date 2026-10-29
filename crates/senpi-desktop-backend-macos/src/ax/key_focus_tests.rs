//! Where keys posted for a window go (oh-my-pi 0838d2ab44 `KeyFocus` tests).

use objc2_application_services::AXError;

use std::cell::Cell;

use super::{content_owner, focused_window, target_window, FocusedWindow, KeyDestination, KeyFocus, WindowContent};

#[test]
fn a_focused_sheet_is_not_the_window_it_is_attached_to() {
    // Finder's Go to Folder sheet 41740 on window 41732: its path field
    // reports 41732 as its AXWindow but lives in the sheet's own window.
    let focus = KeyFocus {
        window: FocusedWindow::Id(41740),
        element_window: Some(41740),
        element_mapped: true,
        element_kind: super::ElementWindowKind::Sheet,
    };
    let attached = |id| (id == 41740).then_some(41732);
    assert_eq!(focus.destination(7, 41732, attached), KeyDestination::Other(Some(41740)));
    assert_eq!(focus.destination(7, 41740, attached), KeyDestination::Target(7));
}

#[test]
fn a_failed_focused_window_read_is_not_an_app_without_one() {
    let none = |_: &u32| -> Option<u32> { None };
    // Only "no value" says the application has no focused window.
    assert_eq!(focused_window(Ok(None), none), FocusedWindow::Unreported);
    assert_eq!(focused_window(Err(AXError::NoValue), none), FocusedWindow::Unreported);
    assert_eq!(focused_window(Ok(Some(5)), |&id| Some(id)), FocusedWindow::Id(5));
    // An application that did not answer in time may have a new modal or
    // sibling focused: keys must not go out as if the target were its only
    // possible key window.
    let unread = focused_window(Err(AXError::CannotComplete), none);
    assert_eq!(unread, FocusedWindow::Unreadable);
    let focus = KeyFocus {
        window: unread,
        ..KeyFocus::default()
    };
    assert_eq!(focus.destination(7, 42, |_| None), KeyDestination::Other(None));
}

#[test]
fn an_editor_overlay_attached_to_the_target_holds_its_focus() {
    // Finder's inline rename field is overlay window 41743, attached to
    // window 41732; while it has focus Finder reports no focused window.
    let focus = KeyFocus {
        window: FocusedWindow::Unreported,
        element_window: Some(41743),
        element_mapped: true,
        element_kind: super::ElementWindowKind::Ordinary,
    };
    let attached = |id| (id == 41743).then_some(41732);
    assert_eq!(focus.destination(7, 41732, attached), KeyDestination::Target(7));
    // Keys addressed to the overlay window itself reach the field too.
    assert_eq!(focus.destination(7, 41743, attached), KeyDestination::Target(7));
    // The same overlay in another Finder window is not this window's.
    assert_eq!(focus.destination(7, 35240, attached), KeyDestination::Unreported);
}

#[test]
fn a_popover_holding_focus_takes_its_own_keys() {
    // Reminders reports its window 79 as focused while a date field in its
    // details popover, window 90 attached to 79, has focus.
    let focus = KeyFocus {
        window: FocusedWindow::Id(79),
        element_window: Some(90),
        element_mapped: true,
        element_kind: super::ElementWindowKind::Popover,
    };
    let attached = |id| (id == 90).then_some(79);
    assert_eq!(focus.destination(7, 90, attached), KeyDestination::Target(7));
    assert_eq!(focus.destination(7, 79, attached), KeyDestination::Target(7));
    // The popover does not take keys while focus is elsewhere in window 79,
    // nor does a window that is not attached to the focused one.
    let elsewhere = KeyFocus {
        element_window: Some(79),
        ..focus
    };
    assert_eq!(elsewhere.destination(7, 90, attached), KeyDestination::Other(Some(79)));
    assert_eq!(focus.destination(7, 90, |_| None), KeyDestination::Other(Some(79)));
}

#[test]
fn a_system_panel_is_drawn_by_the_process_its_children_map_to() {
    // TextEdit (pid 7581) shows its Open panel as window 554, whose one child
    // maps to window 556 of openAndSavePanelService (pid 7592). Its Go to
    // Folder sheet 561 has three children that map to no window and one in
    // the service's window 559.
    let owners = |id| match id {
        556 | 559 => Some(7592),
        543 | 554 | 561 => Some(7581),
        _ => None,
    };
    let remote = |window| WindowContent::Remote { pid: 7592, window };
    assert_eq!(content_owner(7581, 554, [Some(556)], owners), remote(556));
    assert_eq!(content_owner(7581, 561, [None, None, None, Some(559)], owners), remote(559));
    // A document window's children map to the window itself.
    assert_eq!(content_owner(7581, 543, [Some(543), Some(543)], owners), WindowContent::Own);
    // A remote view embedded beside the window's own controls is not the
    // window's content.
    assert_eq!(content_owner(7581, 543, [Some(556), Some(543)], owners), WindowContent::Own);
    // A child in another window of the same process, an owner that cannot be
    // read, or no mapped child at all shows no other process.
    assert_eq!(content_owner(7581, 561, [Some(554), Some(559)], owners), WindowContent::Own);
    assert_eq!(content_owner(7581, 554, [Some(999)], owners), WindowContent::Own);
    // An unreadable owner beside a remote child still shows the window's own
    // content: the read did not prove another process.
    assert_eq!(content_owner(7581, 554, [Some(999), Some(556)], owners), WindowContent::Own);
    assert_eq!(content_owner(7581, 554, [None, None], owners), WindowContent::Own);
}

#[test]
fn a_panel_behind_another_window_is_read_from_its_own_window() {
    // TextEdit's document window 543 is focused while its Open panel 554
    // is not: the panel's content still comes from window 554.
    let found = Cell::new(false);
    let find = || {
        found.set(true);
        Some(554)
    };
    assert_eq!(target_window(554, Some(543), |&id| Some(id), find), Some(554));
    assert!(found.get());
    // The focused window answers for itself without a search.
    found.set(false);
    assert_eq!(target_window(554, Some(554), |&id| Some(id), find), Some(554));
    assert!(!found.get());
    // Neither the focused window nor a search shows the window.
    assert_eq!(target_window(554, Some(543), |&id| Some(id), || None::<u32>), None);
}
