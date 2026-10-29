use super::*;
use super::signals::UserSwitch;

const USER: u32 = 100;
const TARGET: u32 = 200;
const THIRD: u32 = 300;

fn lease(now: Instant) -> BackgroundFocusLease {
    BackgroundFocusLease::new(USER, TARGET, Some(42), SwitchSignals::default(), now)
}

#[test]
fn user_switch_watch_names_how_the_user_picked_an_app() {
    let now = Instant::now();
    for (signals, expected) in [
        (SwitchSignals::default(), None),
        (
            SwitchSignals {
                chord: true,
                ..Default::default()
            },
            Some(UserSwitch::Chord),
        ),
        (
            SwitchSignals {
                key_focus: Some(THIRD),
                ..Default::default()
            },
            Some(UserSwitch::Panel),
        ),
        (
            SwitchSignals {
                last_click: Some(now),
                ..Default::default()
            },
            Some(UserSwitch::Click),
        ),
        (
            SwitchSignals {
                key_focus: Some(TARGET),
                ..Default::default()
            },
            None,
        ),
        (
            SwitchSignals {
                key_focus: Some(USER),
                ..Default::default()
            },
            None,
        ),
    ] {
        let watch = UserSwitchWatch::new(USER, TARGET, signals, now, USER_SWITCH_WINDOW);
        assert_eq!(watch.picked(now, TARGET), expected);
    }
}

#[test]
fn user_focus_changes_permanently_disarm_background_restoration() {
    let now = Instant::now();
    let mut guard = lease(now);
    assert_eq!(
        guard.observe(TARGET, None, SwitchSignals::default(), now),
        FocusDecision::Restore
    );
    let clicked = SwitchSignals {
        buttons: [1, 0, 0, 0, 0, 0],
        last_click: Some(now),
        ..Default::default()
    };
    assert_eq!(
        guard.observe(THIRD, None, clicked, now),
        FocusDecision::Disarm
    );
    assert!(!guard.visited);
    assert_eq!(
        guard.observe(TARGET, None, clicked, now),
        FocusDecision::Disarm
    );
    assert!(guard.visited);
    guard.observe(
        USER,
        Some(42),
        SwitchSignals::default(),
        now + Duration::from_secs(9),
    );
    assert!(guard.disarmed && guard.visited);
}

#[test]
fn a_third_app_the_action_brings_forward_is_sent_back_like_the_target() {
    let now = Instant::now();
    let mut guard = lease(now);
    assert_eq!(
        guard.observe(
            THIRD,
            None,
            SwitchSignals::default(),
            now + Duration::from_millis(500)
        ),
        FocusDecision::Restore
    );
    // The first sighting determines causality, not the observer's later poll.
    assert_eq!(
        guard.observe(
            THIRD,
            None,
            SwitchSignals::default(),
            now + Duration::from_secs(5)
        ),
        FocusDecision::Restore
    );
}

#[test]
fn the_target_is_sent_back_however_late_but_another_app_only_right_after_an_act() {
    let now = Instant::now();
    for (front, delay, expected) in [
        (TARGET, 50_000, FocusDecision::Restore),
        (THIRD, 501, FocusDecision::Disarm),
        (THIRD, 500, FocusDecision::Restore),
    ] {
        let mut guard = lease(now);
        assert_eq!(
            guard.observe(
                front,
                None,
                SwitchSignals::default(),
                now + Duration::from_millis(delay)
            ),
            expected
        );
    }
    let mut guard = lease(now);
    let sent = SwitchSignals {
        last_send: Some(now + Duration::from_secs(9)),
        ..Default::default()
    };
    assert_eq!(
        guard.observe(THIRD, None, sent, now + Duration::from_millis(9_500)),
        FocusDecision::Restore
    );
}

#[test]
fn an_own_app_click_changes_the_retained_window_only_once() {
    let now = Instant::now();
    let mut guard = lease(now);
    let clicked = SwitchSignals {
        buttons: [1, 0, 0, 0, 0, 0],
        last_click: Some(now),
        in_user_app: true,
        ..Default::default()
    };
    assert_eq!(
        guard.observe(USER, Some(43), clicked, now),
        FocusDecision::Observe
    );
    assert_eq!(guard.key, Some(43));
    assert_eq!(
        guard.observe(USER, Some(44), clicked, now),
        FocusDecision::Disarm
    );
}

mod seeded;
