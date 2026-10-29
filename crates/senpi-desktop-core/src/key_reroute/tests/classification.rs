use super::*;

#[test]
fn picking_the_target_while_it_holds_the_keyboard_ends_the_theft() {
    let now = Instant::now();
    let tabbed = UserSignals {
        buttons: BUTTONS,
        last_chord: Some(now),
    };
    let clicked = UserSignals {
        buttons: CLICKED,
        last_chord: None,
    };
    // Its menu has the keyboard; the user ⌘-Tabs, uses a ⌃ launcher hotkey
    // or clicks to bring it forward, and types into it.
    for signals in [tabbed, clicked] {
        let mut rig = Rig::new();
        rig.steal();
        rig.theft.notify(NEW_FRONT, 1, TARGET, signals, now);
        assert_eq!(rig.key(Q, Stroke::Press), KEPT);
    }
    // Spotlight's panel takes the keyboard from the target's menu.
    let mut rig = Rig::new();
    rig.steal();
    rig.notify(KEY_FOCUS_TAKEN, TARGET, SPOTLIGHT);
    assert_eq!(rig.key(Q, Stroke::Press), KEPT);
    // The target coming forward on its own keeps the theft.
    let mut rig = Rig::new();
    rig.steal();
    rig.notify(NEW_FRONT, 1, TARGET);
    assert_eq!(rig.key(Q, Stroke::Press), MOVED);

    // The same, read back after the focus tap was disabled.
    for (front, focus, signals) in [
        (TARGET, None, tabbed),
        (TARGET, None, clicked),
        (TARGET, Some(SPOTLIGHT), quiet()),
    ] {
        let mut theft = theft();
        theft.notify(KEY_FOCUS_TAKEN, USER, TARGET, quiet(), now);
        theft.resync(front, focus, signals, now);
        assert_eq!(theft.holder, Holder::UserChose, "focus {focus:?}");
    }
    let mut theft = theft();
    theft.notify(KEY_FOCUS_TAKEN, USER, TARGET, quiet(), now);
    theft.resync(TARGET, None, quiet(), now);
    assert!(theft.stolen());
}

#[test]
fn the_repair_lingers_only_behind_the_users_app_and_for_at_most_30_s() {
    let linger = |front, lingered| {
        let mut theft = theft();
        theft.notify(KEY_FOCUS_TAKEN, USER, TARGET, quiet(), Instant::now());
        theft.linger(front, lingered);
        theft.stolen()
    };
    // A menu left open behind the user's app.
    assert!(linger(Some(USER), Duration::from_secs(1)));
    assert!(linger(None, Duration::from_secs(1)), "front unknown");
    // The target in front after the action, or 30 s on.
    assert!(!linger(Some(TARGET), Duration::ZERO));
    assert!(!linger(Some(USER), LINGER_MAX));
}

#[test]
fn only_keys_no_process_posted_are_typed_by_the_user() {
    assert!(typed_by_user(0, 0, SYNTHETIC_EVENT_TAG));
    assert!(
        typed_by_user(0, 42, SYNTHETIC_EVENT_TAG),
        "a hardware driver's tag"
    );
    assert!(
        !typed_by_user(0, SYNTHETIC_EVENT_TAG, SYNTHETIC_EVENT_TAG),
        "the engine's own HID keys"
    );
    assert!(
        !typed_by_user(4321, 0, SYNTHETIC_EVENT_TAG),
        "an automation tool's keys"
    );
    assert!(!typed_by_user(
        4321,
        SYNTHETIC_EVENT_TAG,
        SYNTHETIC_EVENT_TAG
    ));
}
