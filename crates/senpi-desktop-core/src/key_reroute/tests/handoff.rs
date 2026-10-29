use super::*;

#[test]
fn a_newer_action_on_the_same_target_takes_over_the_held_keys() {
    let mut old = Rig::new();
    old.steal();
    assert_eq!(old.key(Q, Stroke::Press), MOVED);
    let mut newer = Theft::new(OTHER_USER, TARGET, BUTTONS, 2);
    let mut registry = old.registry;
    register(&mut newer, &mut registry);
    newer.notify(KEY_FOCUS_TAKEN, OTHER_USER, TARGET, quiet(), Instant::now());
    let mut route = |theft: &mut Theft, code, stroke| {
        theft.route(&mut registry, user_key(code, stroke), false, BUTTONS)
    };
    let mut old = old.theft;
    assert_eq!(route(&mut newer, Q, Stroke::Release), MOVED);
    assert_eq!(
        route(&mut newer, LEFT_SHIFT, Stroke::Press),
        Some(OTHER_USER)
    );
    assert_eq!(route(&mut old, LEFT_SHIFT, Stroke::Release), KEPT);
    assert_eq!(route(&mut old, Q, Stroke::Press), KEPT);
    assert_eq!(
        route(&mut newer, LEFT_SHIFT, Stroke::Release),
        Some(OTHER_USER)
    );
    newer.notify(
        KEY_FOCUS_RETURNED,
        OTHER_USER,
        OTHER_USER,
        quiet(),
        Instant::now(),
    );
    assert!(newer.settled(&registry));
}

#[test]
fn a_newer_action_on_the_same_target_takes_over_a_theft_in_progress() {
    let mut old = Rig::new();
    old.steal();
    let mut newer = Theft::new(USER, TARGET, BUTTONS, 2);
    let mut registry = old.registry;
    register(&mut newer, &mut registry);
    let mut old = old.theft;
    assert_eq!(registry.latest, (2, TARGET));
    assert_eq!(
        newer.route(&mut registry, user_key(Q, Stroke::Press), false, BUTTONS),
        MOVED
    );
    assert_eq!(
        old.route(&mut registry, user_key(Q, Stroke::Release), false, BUTTONS),
        KEPT
    );
    assert_eq!(
        newer.route(&mut registry, user_key(Q, Stroke::Release), false, BUTTONS),
        MOVED
    );
    for (given_back, target) in [(true, TARGET), (false, OTHER_TARGET)] {
        let mut old = Rig::new();
        old.steal();
        if given_back {
            old.give_back();
        }
        let mut newer = Theft::new(USER, target, BUTTONS, 2);
        register(&mut newer, &mut old.registry);
        assert_eq!(newer.holder, Holder::Elsewhere, "target {target}");
        assert_eq!(old.registry.stolen, None);
    }
    let mut rig = Rig::new();
    rig.registry.latest = (5, OTHER_TARGET);
    register(&mut rig.theft, &mut rig.registry);
    assert_eq!(rig.registry.latest, (5, OTHER_TARGET));
}

#[test]
fn a_newer_action_reads_a_theft_the_last_repair_gave_up_on() {
    let mut old = Rig::new();
    old.steal();
    old.theft.linger(Some(USER), LINGER_MAX);
    old.theft.publish(&mut old.registry);
    assert_eq!(old.registry.stolen, None);
    let mut newer = Theft::new(USER, TARGET, BUTTONS, 2);
    let mut registry = old.registry;
    newer.register(
        &mut registry,
        Some((USER, Some(TARGET))),
        quiet(),
        Instant::now(),
    );
    assert_eq!(registry.stolen, Some(BUTTONS));
    assert_eq!(
        newer.route(&mut registry, user_key(Q, Stroke::Press), false, BUTTONS),
        MOVED
    );
}
