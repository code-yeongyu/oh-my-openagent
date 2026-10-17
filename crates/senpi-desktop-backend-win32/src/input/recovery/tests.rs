use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_KEYBOARD, INPUT_MOUSE, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
};

use super::pending_input_releases;
use crate::input::events::{key_event, mouse_event};

#[derive(Debug, PartialEq, Eq)]
enum Release {
    Key(u16, u16, u32),
    Mouse(u32),
}

fn releases(events: &[INPUT]) -> Vec<Release> {
    pending_input_releases(events)
        .iter()
        .map(|event| {
            // SAFETY: [Category 5 - Invalid values] the production planner
            // returns tagged keyboard or mouse INPUTs from events.rs.
            unsafe {
                match event.r#type {
                    INPUT_KEYBOARD => {
                        let key = event.Anonymous.ki;
                        Release::Key(key.wVk, key.wScan, key.dwFlags)
                    }
                    INPUT_MOUSE => Release::Mouse(event.Anonymous.mi.dwFlags),
                    other => panic!("unexpected INPUT type {other}"),
                }
            }
        })
        .collect()
}

#[test]
fn releases_only_unmatched_downs_from_the_accepted_prefix() {
    let events = [
        key_event(17, 0, 0),
        key_event(65, 0, 0),
        key_event(65, 0, KEYEVENTF_KEYUP),
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0),
        mouse_event(MOUSEEVENTF_MOVE, 0, 20, 30),
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0),
        key_event(17, 0, KEYEVENTF_KEYUP),
    ];
    assert_eq!(
        releases(&events[..5]),
        [
            Release::Key(17, 0, KEYEVENTF_KEYUP),
            Release::Mouse(MOUSEEVENTF_LEFTUP),
        ]
    );
    assert!(releases(&events).is_empty());
    assert!(releases(&[]).is_empty());
}

#[test]
fn unicode_scan_and_extended_flags_are_distinct_release_identities() {
    let events = [
        key_event(0, 0xd83d, KEYEVENTF_UNICODE),
        key_event(0, 0xde42, KEYEVENTF_UNICODE),
        key_event(0, 0xd83d, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
        key_event(17, 0, KEYEVENTF_EXTENDEDKEY),
        key_event(17, 0, 0),
        key_event(17, 0, KEYEVENTF_KEYUP),
    ];
    assert_eq!(
        releases(&events),
        [
            Release::Key(0, 0xde42, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
            Release::Key(17, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP),
        ]
    );
}

#[test]
fn repeated_downs_release_once_and_unmatched_ups_release_nothing() {
    assert_eq!(
        releases(&[
            key_event(17, 0, KEYEVENTF_KEYUP),
            key_event(65, 0, 0),
            key_event(65, 0, 0),
        ]),
        [Release::Key(65, 0, KEYEVENTF_KEYUP)]
    );
}

#[test]
fn mouse_buttons_keep_independent_release_state() {
    let events = [
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0),
        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0),
        mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0),
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0),
    ];
    assert_eq!(
        releases(&events),
        [
            Release::Mouse(MOUSEEVENTF_RIGHTUP),
            Release::Mouse(MOUSEEVENTF_MIDDLEUP),
        ]
    );
}
