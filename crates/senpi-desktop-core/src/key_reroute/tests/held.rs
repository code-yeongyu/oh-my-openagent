use super::*;

#[test]
fn a_release_follows_its_moved_press_after_the_user_gets_focus_back() {
    let mut rig = Rig::new();
    rig.steal();
    assert_eq!(rig.key(Q, Stroke::Press), MOVED);
    rig.give_back();
    assert!(
        !rig.settled(),
        "the taps must outlive the theft while q is down"
    );
    assert_eq!(rig.key(Q, Stroke::Repeat), MOVED);
    assert_eq!(rig.key(Q, Stroke::Release), MOVED);
    assert!(rig.settled());
    // The next keystroke is the target's again.
    assert_eq!(rig.key(Q, Stroke::Press), KEPT);
    assert_eq!(rig.key(Q, Stroke::Release), KEPT);
}

#[test]
fn a_release_follows_its_press_into_the_target_after_a_theft_starts() {
    let mut rig = Rig::new();
    assert_eq!(rig.key(Q, Stroke::Press), KEPT);
    rig.steal();
    assert_eq!(rig.key(Q, Stroke::Repeat), KEPT);
    assert_eq!(rig.key(Q, Stroke::Release), KEPT);
    // A release whose press the tap never saw is decided like a press.
    assert_eq!(rig.key(Q, Stroke::Release), MOVED);
}

#[test]
fn a_key_first_seen_repeating_counts_as_pressed_then() {
    // Q went down into the user's app before the action; its repeats reach
    // the target once it takes the keyboard.
    let mut rig = Rig::new();
    rig.steal();
    assert_eq!(rig.key(Q, Stroke::Repeat), MOVED);
    rig.give_back();
    assert!(!rig.settled());
    assert_eq!(rig.key(Q, Stroke::Release), MOVED);
    assert!(rig.settled());
}

#[test]
fn a_modifier_release_follows_its_moved_press() {
    assert_eq!(
        Stroke::of_modifier(LEFT_SHIFT, 0x0002_0102),
        Some(Stroke::Press)
    );
    assert_eq!(
        Stroke::of_modifier(LEFT_SHIFT, 0x0000_0100),
        Some(Stroke::Release)
    );
    // Right shift still down: the flag stays, the left key's bit does not.
    assert_eq!(
        Stroke::of_modifier(LEFT_SHIFT, 0x0002_0104),
        Some(Stroke::Release)
    );
    assert_eq!(Stroke::of_modifier(57, 0x0001_0100), None, "caps lock");
    let mut rig = Rig::new();
    rig.steal();
    assert_eq!(rig.key(LEFT_SHIFT, Stroke::Press), MOVED);
    rig.give_back();
    assert_eq!(rig.key(LEFT_SHIFT, Stroke::Release), MOVED);
}

#[test]
fn after_the_linger_or_a_newer_action_elsewhere_only_held_keys_move() {
    for supersede in [false, true] {
        let mut rig = Rig::new();
        rig.steal();
        assert_eq!(rig.key(Q, Stroke::Press), MOVED);
        if supersede {
            rig.registry.latest = (2, OTHER_TARGET);
        } else {
            rig.theft.end();
        }
        rig.steal();
        assert_eq!(rig.key(LEFT_SHIFT, Stroke::Press), KEPT);
        assert!(!rig.settled());
        assert_eq!(rig.key(Q, Stroke::Release), MOVED);
        assert!(rig.settled());
    }
}

#[test]
fn the_holder_is_read_again_after_the_focus_tap_was_disabled() {
    let now = Instant::now();
    // The target took the keyboard, by menu or by coming forward, while the
    // tap was off.
    for (front, key_focus) in [(USER, Some(TARGET)), (TARGET, None), (TARGET, Some(TARGET))] {
        let mut theft = theft();
        theft.resync(front, key_focus, quiet(), now);
        assert!(
            theft.reroutes(false, BUTTONS),
            "front {front}, focus {key_focus:?}"
        );
        // It still has it: the theft stands.
        theft.resync(front, key_focus, quiet(), now);
        assert!(theft.stolen());
    }
    // The keyboard came back to the user's app, or the user went to another.
    for (front, key_focus) in [(USER, Some(USER)), (OTHER_USER, Some(OTHER_USER))] {
        let mut theft = theft();
        theft.notify(KEY_FOCUS_TAKEN, USER, TARGET, quiet(), now);
        theft.resync(front, key_focus, quiet(), now);
        assert_eq!(
            theft.holder,
            Holder::Elsewhere,
            "front {front}, focus {key_focus:?}"
        );
    }
    // A click before the target came, or another process's panel in the
    // user's app, is the user's choice.
    let clicked = UserSignals {
        buttons: CLICKED,
        last_chord: None,
    };
    let mut theft = theft();
    theft.resync(TARGET, None, clicked, now);
    assert_eq!(theft.holder, Holder::UserChose);
    let mut theft = self::theft();
    theft.resync(USER, Some(SPOTLIGHT), quiet(), now);
    assert_eq!(theft.holder, Holder::UserChose);
}

#[test]
fn a_theft_stands_when_the_key_focus_cannot_be_read() {
    let now = Instant::now();
    // The target's menu may still have the keyboard behind the front app.
    for front in [USER, OTHER_USER] {
        let mut theft = theft();
        theft.notify(KEY_FOCUS_TAKEN, USER, TARGET, quiet(), now);
        theft.resync(front, None, quiet(), now);
        assert!(theft.stolen(), "front {front}");
    }
    // Nor does an unread key focus make a theft behind the user's app.
    let mut theft = theft();
    theft.resync(USER, None, quiet(), now);
    assert_eq!(theft.holder, Holder::Elsewhere);
}

#[test]
fn keys_a_process_posts_to_the_target_are_never_moved() {
    // An automation tool's shortcut for the target, while it holds the
    // keyboard, stays the target's, and leaves the user's held key alone.
    let mut rig = Rig::new();
    rig.steal();
    assert_eq!(rig.key(Q, Stroke::Press), MOVED);
    let mut posted = |code, stroke| {
        rig.theft
            .route(&mut rig.registry, posted_key(code, stroke), false, BUTTONS)
    };
    assert_eq!(posted(LEFT_SHIFT, Stroke::Press), KEPT);
    assert_eq!(posted(Q, Stroke::Press), KEPT);
    assert_eq!(posted(Q, Stroke::Release), KEPT);
    assert_eq!(rig.key(Q, Stroke::Release), MOVED);
}

#[test]
fn no_key_pressed_during_secure_entry_moves_but_a_moved_press_keeps_its_release() {
    let mut rig = Rig::new();
    rig.steal();
    assert_eq!(rig.key_with(Q, Stroke::Press, true), KEPT);
    assert_eq!(rig.key_with(Q, Stroke::Repeat, true), KEPT);
    assert_eq!(rig.key_with(Q, Stroke::Release, true), KEPT);
    assert_eq!(rig.key(LEFT_SHIFT, Stroke::Press), MOVED);
    assert_eq!(rig.key_with(LEFT_SHIFT, Stroke::Release, true), MOVED);
}

#[test]
fn the_agents_own_keys_never_take_a_held_keys_release() {
    let mut rig = Rig::new();
    rig.steal();
    let mut own = |stroke| {
        rig.theft
            .route(&mut rig.registry, posted_key(Q, stroke), false, BUTTONS)
    };
    assert_eq!(own(Stroke::Press), KEPT);
    assert_eq!(own(Stroke::Release), KEPT);
    let mut rig = Rig::new();
    rig.steal();
    assert_eq!(rig.key(Q, Stroke::Press), MOVED);
    assert_eq!(
        rig.theft.route(
            &mut rig.registry,
            posted_key(Q, Stroke::Release),
            false,
            BUTTONS
        ),
        KEPT
    );
    rig.give_back();
    assert_eq!(rig.key(Q, Stroke::Release), MOVED);
}

#[test]
fn a_release_that_went_around_the_tap_is_forgotten_after_the_grace() {
    let t0 = Instant::now();
    let ms = Duration::from_millis;
    let held = |target| Held {
        target,
        code: Q,
        to: MOVED,
        lifted_at: None,
    };
    let mut keys = vec![held(TARGET), held(OTHER_TARGET)];
    forget_lifted(&mut keys, TARGET, |_| true, t0);
    forget_lifted(&mut keys, TARGET, |_| false, t0 + ms(10));
    forget_lifted(&mut keys, TARGET, |_| false, t0 + ms(9) + RELEASE_GRACE);
    assert_eq!(keys.len(), 2, "the release may still be on its way");
    forget_lifted(&mut keys, TARGET, |_| false, t0 + ms(10) + RELEASE_GRACE);
    assert_eq!(keys.len(), 1);
    assert_eq!(
        keys[0].target, OTHER_TARGET,
        "another target's keys are its taps' to forget"
    );
}
