use std::collections::BTreeMap;

use super::*;

#[test]
fn seeded_interleavings_preserve_physical_only_delivery_and_held_pairs() {
    let anchor = Instant::now();
    for run in 1..=64 {
        let mut rng = 0xa076_1d64_78bd_642f_u64 ^ run;
        let mut rig = Rig::new();
        let mut expected_held = BTreeMap::new();
        let mut stolen = false;
        let mut terminal = false;
        let mut clicked = false;
        let mut secure = false;
        for step in 0..512 {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            let now = anchor + Duration::from_millis(step * 7);
            let buttons = if clicked { CLICKED } else { BUTTONS };
            match rng % 12 {
                0 => {
                    rig.theft.notify(
                        NEW_FRONT,
                        USER,
                        TARGET,
                        UserSignals {
                            buttons,
                            last_chord: None,
                        },
                        now,
                    );
                    if !terminal {
                        if clicked {
                            terminal = true;
                        } else {
                            stolen = true;
                        }
                    }
                }
                1 => {
                    rig.theft
                        .notify(KEY_FOCUS_RETURNED, USER, USER, quiet(), now);
                    stolen = false;
                }
                2 => {
                    rig.theft.notify(
                        NEW_FRONT,
                        USER,
                        OTHER_USER,
                        UserSignals {
                            buttons,
                            last_chord: Some(now),
                        },
                        now,
                    );
                    terminal = true;
                }
                3 => clicked = true,
                4 => secure = !secure,
                5 => {
                    rig.registry.latest = (2, OTHER_TARGET);
                    terminal = true;
                }
                6 => {
                    rig.theft.end();
                    terminal = true;
                }
                _ => {
                    let code = [Q, LEFT_SHIFT, 57][((rng >> 16) % 3) as usize];
                    let stroke = [
                        Some(Stroke::Press),
                        Some(Stroke::Repeat),
                        Some(Stroke::Release),
                        None,
                    ][((rng >> 24) % 4) as usize];
                    let physical = rng & 0x100 != 0;
                    let fresh = (stolen && !terminal && !clicked && !secure).then_some(USER);
                    let expected = if !physical {
                        None
                    } else {
                        match stroke {
                            Some(Stroke::Release) => expected_held.remove(&code).unwrap_or(fresh),
                            Some(Stroke::Repeat) => *expected_held.entry(code).or_insert(fresh),
                            Some(Stroke::Press) => {
                                expected_held.insert(code, fresh);
                                fresh
                            }
                            None => fresh,
                        }
                    };
                    let actual = rig.theft.route(
                        &mut rig.registry,
                        Key {
                            physical,
                            code,
                            stroke,
                        },
                        secure,
                        buttons,
                    );
                    assert_eq!(actual, expected, "run {run}, step {step}");
                    let actual_held: BTreeMap<_, _> = rig
                        .registry
                        .held
                        .iter()
                        .map(|held| (held.code, held.to))
                        .collect();
                    assert_eq!(actual_held, expected_held, "run {run}, step {step}");
                }
            }
        }
    }
}
