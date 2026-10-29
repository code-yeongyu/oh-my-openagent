//! Background keyboard routing decisions (oh-my-pi 0838d2ab44 tests).

use senpi_desktop_core::error::ErrorCode;

use super::{
    attached_under, decide, input_owner, key_process, key_refusal, keyboard_conflict, keys_still_reach,
    owner_still_focused, KeyDecision, KeyboardConflict,
};
use crate::ax::{AxWindowRecord, FocusedWindow, KeyDestination, KeyFocus, WindowContent};

const fn record(id: u32, minimized: Option<bool>) -> AxWindowRecord {
    AxWindowRecord {
        id: Some(id),
        minimized,
    }
}

#[test]
fn keyboard_destination_counts_only_windows_that_can_be_key() {
    let listed_only = || false;
    assert_eq!(keyboard_conflict(10, &[record(10, Some(false))], listed_only), None);
    assert_eq!(keyboard_conflict(10, &[record(10, Some(false)), record(11, Some(true))], listed_only), None);
    assert_eq!(
        keyboard_conflict(10, &[record(10, Some(false)), record(11, None), record(12, Some(false))], listed_only),
        Some(KeyboardConflict::Siblings(2)),
    );
    assert_eq!(keyboard_conflict(10, &[record(11, Some(false))], listed_only), Some(KeyboardConflict::Unmapped));
}

#[test]
fn ax_window_without_an_id_is_a_sibling_not_a_failure() {
    // Finder lists its desktop in AXWindows with no window id.
    let desktop = AxWindowRecord { id: None, minimized: None };
    assert_eq!(
        keyboard_conflict(10, &[record(10, Some(false)), desktop], || false),
        Some(KeyboardConflict::Siblings(1)),
    );
}

#[test]
fn a_sheet_outside_ax_windows_is_a_window_of_its_application() {
    // Finder's Go to Folder sheet 41740 is attached to window 41732 and
    // missing from AXWindows, which lists the window, another one and the
    // desktop: keys for the sheet wait until it is the focused window.
    let desktop = AxWindowRecord { id: None, minimized: None };
    let records = [record(41732, Some(false)), record(35240, Some(false)), desktop];
    assert_eq!(keyboard_conflict(41740, &records, || true), Some(KeyboardConflict::Siblings(3)));
    assert_eq!(keyboard_conflict(41740, &records, || false), Some(KeyboardConflict::Unmapped));
    // A sheet opened on a sheet: 191 on 186 on listed window 177.
    let parents = |id| match id {
        191 => Some(186),
        186 => Some(177),
        _ => None,
    };
    assert!(attached_under(191, parents, |parent| parent == 177));
    assert!(!attached_under(177, parents, |parent| parent == 177));
}

#[test]
fn keys_wait_while_the_application_reports_another_focused_window() {
    // Finder's Go to Folder sheet 41740 is attached to window 41732 and is
    // Finder's focused window; keys posted to Finder land in the sheet.
    let sheet = KeyDestination::Other(Some(41740));
    assert_eq!(decide(7, sheet, None), KeyDecision::Wait);
    assert_eq!(decide(7, sheet, Some(KeyboardConflict::Siblings(3))), KeyDecision::Wait);
    assert_eq!(decide(7, KeyDestination::Other(None), None), KeyDecision::Wait);
    assert_eq!(decide(7, KeyDestination::Target(7), None), KeyDecision::Deliver(7));
    // No focused window reported: only a lone window proves the destination.
    assert_eq!(decide(7, KeyDestination::Unreported, None), KeyDecision::Deliver(7));
    assert_eq!(decide(7, KeyDestination::Unreported, Some(KeyboardConflict::Siblings(1))), KeyDecision::Wait);
}

#[test]
fn keys_for_a_window_behind_its_own_sheet_name_the_sheet() {
    let parents = |id| match id {
        41740 => Some(41732),
        191 => Some(186),
        186 => Some(177),
        _ => None,
    };
    let sheet = key_refusal(41732, KeyDestination::Other(Some(41740)), None, parents);
    assert_eq!(sheet.code, ErrorCode::InvalidTarget);
    assert!(sheet.message.contains("send them to window 41740"), "{}", sheet.message);
    // A sheet opened on another sheet still blocks the window under both.
    let nested = key_refusal(177, KeyDestination::Other(Some(191)), None, parents);
    assert_eq!(nested.code, ErrorCode::InvalidTarget);
    // A focused window that is not attached can still be replaced in the
    // foreground.
    let sibling = key_refusal(41732, KeyDestination::Other(Some(35240)), None, parents);
    assert_eq!(sibling.code, ErrorCode::BackgroundUnavailable);
    assert!(sibling.message.contains("window 35240 still is"), "{}", sibling.message);
    assert!(sibling.message.contains("nothing was sent"), "{}", sibling.message);
    let unproven = key_refusal(41732, KeyDestination::Unreported, Some(KeyboardConflict::Siblings(2)), parents);
    assert_eq!(unproven.code, ErrorCode::BackgroundUnavailable);
    assert!(unproven.message.contains("2 other window(s)"), "{}", unproven.message);
}

#[test]
fn keys_for_a_system_panel_go_to_the_process_that_draws_it() {
    let focus = |window, element, mapped| KeyFocus {
        window: FocusedWindow::Id(window),
        element_window: Some(element),
        element_mapped: mapped,
        element_kind: crate::ax::ElementWindowKind::Ordinary,
    };
    let unread = || -> WindowContent { panic!("focus in the window itself proves the host") };
    let unasked = |_| -> Option<u32> { panic!("no other process is involved") };
    // TextEdit (pid 7581) reports its Open panel 554 as focused; the focused
    // list is in window 556 of openAndSavePanelService (pid 7592), which
    // reports that window focused.
    let open = focus(554, 556, true);
    let drawn = |window| move || WindowContent::Remote { pid: 7592, window };
    assert_eq!(key_process(7581, 554, &open, drawn(556), |_| Some(556)).unwrap(), (7592, 556));
    // Its Go to Folder sheet 561: the path field maps to no window, so the
    // ascent ends at the sheet, and the service draws it in window 559.
    let go_to = focus(561, 561, false);
    assert_eq!(key_process(7581, 561, &go_to, drawn(559), |_| Some(559)).unwrap(), (7592, 559));
    // While the service reports focus in another window, nothing is sent.
    let error = key_process(7581, 554, &open, drawn(556), |_| Some(559)).expect_err("keys the service would not take must refuse");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(error.message.contains("process 7592"), "{}", error.message);
    // A window drawn by its own process keeps the keys.
    assert_eq!(key_process(7581, 554, &open, || WindowContent::Own, unasked).unwrap(), (7581, 554));
    // A focused element in the window itself, or Finder's rename overlay
    // while Finder reports no focused window, never reads the content.
    assert_eq!(key_process(7581, 543, &focus(543, 543, true), unread, unasked).unwrap(), (7581, 543));
    let rename = KeyFocus {
        window: FocusedWindow::Unreported,
        element_window: Some(41743),
        element_mapped: true,
        element_kind: crate::ax::ElementWindowKind::Ordinary,
    };
    assert_eq!(key_process(7, 41732, &rename, unread, unasked).unwrap(), (7, 41732));
    assert_eq!(input_owner(7581, 554, WindowContent::Own, unasked).unwrap(), (7581, 554));
}

#[test]
fn background_keys_stop_once_another_window_becomes_key() {
    // TextEdit (pid 7) proved window 42 focused; after a key its second
    // document 43 becomes key: the next press refuses as InputFailed.
    let proven = KeyFocus {
        window: FocusedWindow::Id(42),
        element_window: Some(42),
        element_mapped: true,
        element_kind: crate::ax::ElementWindowKind::Ordinary,
    };
    let unread = || -> Option<KeyboardConflict> { panic!("a reported destination needs no window set") };
    assert!(keys_still_reach(7, 42, unread, proven, || proven, |_| None).is_ok());
    let moved = KeyFocus {
        window: FocusedWindow::Id(43),
        element_window: Some(43),
        element_mapped: true,
        element_kind: crate::ax::ElementWindowKind::Ordinary,
    };
    let error = keys_still_reach(7, 42, unread, proven, || moved, |_| None).unwrap_err();
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(error.message.contains("may already have landed"), "{}", error.message);
}

#[test]
fn background_keys_stop_once_the_overlay_holding_focus_closes() {
    // Finder's rename overlay 41743 on window 41732 proved the keys; once it
    // closes, Finder still reports no focused window and the element sits in
    // the window itself: the press would land in the file list.
    let attached = |id| (id == 41743).then_some(41732);
    let proven = KeyFocus {
        window: FocusedWindow::Unreported,
        element_window: Some(41743),
        element_mapped: true,
        element_kind: crate::ax::ElementWindowKind::Ordinary,
    };
    assert!(keys_still_reach(7, 41732, || None, proven, || proven, attached).is_ok());
    let closed = KeyFocus {
        element_window: Some(41732),
        ..proven
    };
    assert_eq!(keys_still_reach(7, 41732, || None, proven, || closed, attached).unwrap_err().code, ErrorCode::InputFailed);
}

#[test]
fn a_window_the_app_opens_while_it_reports_no_focus_stops_the_keys() {
    // A lone window proved the keys with no focused window reported; a window
    // the app opens meanwhile could be taking them.
    let proven = KeyFocus::default();
    assert!(keys_still_reach(7, 42, || None, proven, || proven, |_| None).is_ok());
    let opened = || Some(KeyboardConflict::Siblings(1));
    assert_eq!(keys_still_reach(7, 42, opened, proven, || proven, |_| None).unwrap_err().code, ErrorCode::InputFailed);
}

#[test]
fn background_keys_for_a_system_panel_stop_once_its_service_focuses_another_window() {
    assert!(owner_still_focused(7581, 554, (7592, 556), |_| Some(556)).is_ok());
    assert!(owner_still_focused(7581, 554, (7581, 554), |_| panic!("the window's own process is not asked")).is_ok());
    let error = owner_still_focused(7581, 554, (7592, 556), |_| Some(559)).unwrap_err();
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(error.message.contains("process 7592"), "{}", error.message);
}
