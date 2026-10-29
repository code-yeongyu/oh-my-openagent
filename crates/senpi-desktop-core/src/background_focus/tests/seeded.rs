use super::*;

#[test]
fn seeded_interleavings_preserve_monotone_ownership_and_first_sighting_causality() {
    // Independent model: no switch signals here except explicit changed-window
    // choices. This isolates activation timing from signal classification above.
    for run in 1..=64 {
        let mut random = 0x9e37_79b9_7f4a_7c15_u64 ^ run;
        let mut next = || {
            random ^= random >> 12;
            random ^= random << 25;
            random ^= random >> 27;
            random.wrapping_mul(0x2545_f491_4f6c_dd1d)
        };
        let start = Instant::now();
        let mut guard = lease(start);
        let mut elapsed = 0;
        let mut sent = 0;
        let mut seen: Option<(u32, bool)> = None;
        let mut disarmed = false;
        let mut visited = false;
        for step in 0..400 {
            elapsed += next() % 700;
            if next() % 4 == 0 {
                sent = elapsed;
            }
            let front = [USER, TARGET, THIRD][(next() % 3) as usize];
            let changed_key = front == USER && next() % 20 == 0;
            let caused = match seen {
                Some((previous, caused)) if previous == front => caused,
                _ => elapsed - sent <= 500,
            };
            seen = Some((front, caused));
            disarmed |= changed_key || (front == THIRD && !caused);
            visited |= disarmed && front == TARGET;
            let expected = if disarmed {
                FocusDecision::Disarm
            } else if front == USER {
                FocusDecision::Observe
            } else {
                FocusDecision::Restore
            };
            let signals = SwitchSignals {
                last_send: Some(start + Duration::from_millis(sent)),
                ..Default::default()
            };
            let actual = guard.observe(
                front,
                changed_key.then_some(43),
                signals,
                start + Duration::from_millis(elapsed),
            );
            assert_eq!(actual, expected, "run {run}, step {step}");
            assert_eq!(
                (guard.disarmed, guard.visited),
                (disarmed, visited),
                "run {run}, step {step}"
            );
        }
    }
}

#[test]
fn seeded_sampler_and_ax_observer_interleavings_never_reacquire_a_user_choice() {
    let start = Instant::now();
    let mut random = 0xd1b5_4a32_d192_ed03_u64;
    for _ in 0..64 {
        let mut guard = lease(start);
        let mut signals = SwitchSignals::default();
        let mut elapsed = 0;
        for _ in 0..256 {
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            elapsed += random % 40;
            let now = start + Duration::from_millis(elapsed);
            let front = [USER, TARGET, THIRD][(random as usize >> 8) % 3];
            match random % 6 {
                0 => {
                    signals.buttons[(random as usize >> 16) % 6] += 1;
                    signals.last_click = Some(now);
                    signals.in_user_app = random & 64 != 0;
                }
                1 => signals.chord = random & 64 != 0,
                2 => signals.key_focus = Some([USER, TARGET, THIRD][(random as usize >> 24) % 3]),
                3 => signals.last_send = Some(now),
                // A later AX placement may reclassify an already sampled click.
                4 => signals.in_user_app = true,
                _ => {}
            }
            let disarmed = guard.disarmed;
            let visited = guard.visited;
            let asked = now - Duration::from_millis((random >> 32) % 300);
            let key = (front == USER && random & 128 != 0).then_some(43);
            let decision = if random & 256 != 0 {
                guard.observe(front, None, signals, now)
            } else {
                guard.observe_read(front, key, asked, signals, now)
            };
            assert!(!disarmed || guard.disarmed);
            assert!(!visited || guard.visited);
            assert!(!guard.disarmed || decision == FocusDecision::Disarm);
            assert!(!(guard.disarmed && front == TARGET) || guard.visited);
        }
    }
}
