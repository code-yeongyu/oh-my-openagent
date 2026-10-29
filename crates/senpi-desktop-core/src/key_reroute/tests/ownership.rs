use super::*;

#[test]
fn superseded_workers_retire_while_the_new_worker_keeps_press_ownership() {
    for moved in [false, true] {
        let mut rig = Rig::new();
        if moved {
            rig.steal();
        }
        let destination = if moved { MOVED } else { KEPT };
        assert_eq!(rig.key(Q, Stroke::Press), destination);
        if !moved {
            rig.steal();
        }
        rig.theft.publish(&mut rig.registry);
        let mut newer = Theft::new(OTHER_USER, TARGET, BUTTONS, 2);
        newer.register(&mut rig.registry, Some((USER, Some(TARGET))), quiet(), Instant::now());
        rig.theft.end();
        assert!(rig.theft.settled(&rig.registry),
            "an observer that cannot route any more keys must release its ports");
        rig.theft.publish(&mut rig.registry);
        for stroke in [Stroke::Repeat, Stroke::Release] {
            assert_eq!(newer.route(&mut rig.registry, Key {
                physical: true, code: Q, stroke: Some(stroke),
            }, false, BUTTONS), destination);
        }
        newer.end();
        assert!(newer.settled(&rig.registry));
    }
}

#[test]
fn a_switch_modifier_counts_while_held_and_when_released() {
    const COMMAND: u64 = 0x0010_0108;
    const CONTROL: u64 = 0x0004_0101;
    const SHIFT: u64 = 0x0002_0102;
    const NONE: u64 = 0x100;
    let t0 = Instant::now();
    let ms = Duration::from_millis;
    // ⌘ held 600 ms for a ⌘-Tab; the target comes forward 5 ms after ⌘ is
    // released.
    let mut chord = Chord::new(NONE, t0);
    chord.flags_changed(COMMAND, t0);
    chord.flags_changed(NONE, t0 + ms(600));
    let mut theft = theft();
    let at = t0 + ms(605);
    let signals = UserSignals {
        buttons: BUTTONS,
        last_chord: chord.last(false, at),
    };
    theft.notify(NEW_FRONT, 1, TARGET, signals, at);
    assert!(!theft.reroutes(false, BUTTONS));
    // ⌃ already held as the action starts, or held without a flags change
    // seen: it is down now.
    assert_eq!(
        Chord::new(CONTROL, t0).last(false, t0 + ms(900)),
        Some(t0 + ms(900))
    );
    assert_eq!(
        Chord::new(NONE, t0).last(true, t0 + ms(50)),
        Some(t0 + ms(50))
    );
    // Shift is no switch.
    let mut shift = Chord::new(NONE, t0);
    shift.flags_changed(SHIFT, t0);
    shift.flags_changed(NONE, t0 + ms(5));
    assert_eq!(shift.last(false, t0 + ms(10)), None);
}

#[test]
fn target_coming_forward_unasked_reroutes_the_users_keys() {
    let mut theft = theft();
    theft.notify(NEW_FRONT, 1, TARGET, quiet(), Instant::now());
    assert!(theft.reroutes(false, BUTTONS));
}

#[test]
fn target_menu_taking_key_focus_reroutes_the_users_keys() {
    let mut theft = theft();
    theft.notify(KEY_FOCUS_TAKEN, USER, TARGET, quiet(), Instant::now());
    assert!(theft.reroutes(false, BUTTONS));
}

#[test]
fn nothing_moves_before_a_theft_or_after_the_user_gets_focus_back() {
    let mut theft = theft();
    assert!(!theft.reroutes(false, BUTTONS));
    theft.notify(KEY_FOCUS_TAKEN, USER, TARGET, quiet(), Instant::now());
    theft.notify(KEY_FOCUS_RETURNED, USER, USER, quiet(), Instant::now());
    assert!(!theft.reroutes(false, BUTTONS));
    theft.notify(NEW_FRONT, 1, TARGET, quiet(), Instant::now());
    theft.notify(NEW_FRONT, 1, USER, quiet(), Instant::now());
    assert!(!theft.reroutes(false, BUTTONS));
}

#[test]
fn a_click_before_the_target_comes_forward_is_the_users_choice() {
    let mut theft = theft();
    let clicked = UserSignals {
        buttons: CLICKED,
        last_chord: None,
    };
    theft.notify(NEW_FRONT, 1, TARGET, clicked, Instant::now());
    assert!(!theft.reroutes(false, CLICKED));
    // Sticky: a later return and theft move nothing either.
    theft.notify(NEW_FRONT, 1, USER, clicked, Instant::now());
    theft.notify(NEW_FRONT, 1, TARGET, clicked, Instant::now());
    assert!(!theft.reroutes(false, CLICKED));
}

#[test]
fn a_recent_command_or_control_is_the_users_switch() {
    let now = Instant::now();
    let mut theft = theft();
    let tabbed = UserSignals {
        buttons: BUTTONS,
        last_chord: Some(now),
    };
    theft.notify(NEW_FRONT, 1, TARGET, tabbed, now + Duration::from_millis(5));
    assert!(!theft.reroutes(false, BUTTONS));
    let mut stale = self::theft();
    stale.notify(
        NEW_FRONT,
        1,
        TARGET,
        tabbed,
        now + CHORD_WINDOW + Duration::from_millis(1),
    );
    assert!(stale.reroutes(false, BUTTONS));
}

#[test]
fn a_switch_to_another_app_keeps_a_later_theft_from_moving_keys() {
    let now = Instant::now();
    let later = now + CHORD_WINDOW + Duration::from_millis(1);
    let tabbed = UserSignals {
        buttons: BUTTONS,
        last_chord: Some(now),
    };
    // The user ⌘-Tabs from their app to another; the target comes forward
    // after the chord window: their keys must not go to the app they left.
    let mut theft = theft();
    theft.notify(NEW_FRONT, 1, OTHER_USER, tabbed, now);
    theft.notify(NEW_FRONT, 1, TARGET, quiet(), later);
    assert!(!theft.reroutes(false, BUTTONS));
    // Switching back to their own app, or another app coming forward on
    // its own, leaves a later theft repaired.
    for (front, signals) in [(USER, tabbed), (OTHER_USER, quiet())] {
        let mut theft = self::theft();
        theft.notify(NEW_FRONT, 1, front, signals, now);
        theft.notify(NEW_FRONT, 1, TARGET, quiet(), later);
        assert!(theft.reroutes(false, BUTTONS), "front {front}");
    }
}

#[test]
fn a_click_while_stolen_hands_the_target_its_keys() {
    let mut theft = theft();
    theft.notify(NEW_FRONT, 1, TARGET, quiet(), Instant::now());
    assert!(!theft.reroutes(false, CLICKED));
    assert!(!theft.reroutes(false, CLICKED));
    assert_eq!(theft.holder, Holder::UserChose);
}

#[test]
fn another_panel_taking_the_keyboard_is_the_users_choice() {
    let mut theft = theft();
    theft.notify(KEY_FOCUS_TAKEN, USER, SPOTLIGHT, quiet(), Instant::now());
    theft.notify(NEW_FRONT, 1, TARGET, quiet(), Instant::now());
    assert!(!theft.reroutes(false, BUTTONS));
}

#[test]
fn no_key_moves_during_secure_entry() {
    let mut theft = theft();
    theft.notify(NEW_FRONT, 1, TARGET, quiet(), Instant::now());
    assert!(!theft.reroutes(true, BUTTONS));
    assert!(theft.reroutes(false, BUTTONS));
}

#[test]
fn every_mouse_button_held_before_arming_vetoes_fresh_keys() {
    for button in 0..3 {
        let mut buttons = BUTTONS;
        buttons[button * 2] += 1;
        let mut theft = Theft::new(USER, TARGET, buttons, 1);
        theft.notify(
            KEY_FOCUS_TAKEN,
            USER,
            TARGET,
            UserSignals {
                buttons,
                last_chord: None,
            },
            Instant::now(),
        );
        assert!(!theft.reroutes(false, buttons), "button {button}");
        assert_eq!(theft.holder, Holder::UserChose);
    }
}

#[test]
fn notifications_to_other_recipients_or_about_other_apps_leave_a_theft_alone() {
    let mut theft = theft();
    theft.notify(KEY_FOCUS_TAKEN, USER, TARGET, quiet(), Instant::now());
    theft.notify(
        KEY_FOCUS_RETURNED,
        SPOTLIGHT,
        SPOTLIGHT,
        quiet(),
        Instant::now(),
    );
    theft.notify(KEY_FOCUS_TAKEN, SPOTLIGHT, TARGET, quiet(), Instant::now());
    assert!(theft.reroutes(false, BUTTONS));
}
