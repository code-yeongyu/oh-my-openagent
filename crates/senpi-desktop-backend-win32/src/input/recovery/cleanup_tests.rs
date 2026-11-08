use windows_sys::Win32::UI::Input::KeyboardAndMouse::KEYEVENTF_KEYUP;

use super::release_accepted_prefix;
use crate::input::events::key_event;

#[test]
fn cleanup_releases_in_reverse_order_and_continues_after_failure() {
    let events = [
        key_event(17, 0, 0),
        key_event(65, 0, 0),
        key_event(66, 0, 0),
    ];
    let mut released = Vec::new();
    let succeeded = release_accepted_prefix(&events, 2, |event| {
        // SAFETY: [Category 5 - Invalid values] these releases derive only
        // from the keyboard INPUTs initialized above.
        let key = unsafe { event.Anonymous.ki };
        released.push((key.wVk, key.dwFlags));
        key.wVk != 65
    });

    assert!(!succeeded);
    assert_eq!(released, [(65, KEYEVENTF_KEYUP), (17, KEYEVENTF_KEYUP)]);
}

#[test]
fn zero_accepted_events_send_no_cleanup_input() {
    let events = [key_event(17, 0, 0)];
    let mut calls = 0;
    let succeeded = release_accepted_prefix(&events, 0, |_| {
        calls += 1;
        true
    });
    assert!(succeeded);
    assert_eq!(calls, 0);
}

#[test]
fn fully_released_prefix_sends_no_cleanup_input() {
    let events = [key_event(17, 0, 0), key_event(17, 0, KEYEVENTF_KEYUP)];
    let mut calls = 0;
    let succeeded = release_accepted_prefix(&events, events.len(), |_| {
        calls += 1;
        true
    });
    assert!(succeeded);
    assert_eq!(calls, 0);
}
