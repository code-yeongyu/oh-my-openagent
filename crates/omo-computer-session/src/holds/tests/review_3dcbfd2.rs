//! The review of #13360 at 3dcbfd293d: a hotkey stop while the session is idle releases every
//! hold at once, with no further call (M4); a bounded call releases exactly its own press, never
//! an earlier hold of the same button (L7); a hold reaching the 100 s bound during a long bounded
//! hold is released then (L8); a release the backend refuses stays in the ledger for the next exit
//! path (L9).

use omo_computer_core::holds::{Held, MAX_HOLD_MS};
use omo_computer_core::intervention::PAUSE_TICK_MS;
use omo_computer_core::methods::Method;
use serde_json::json;

use super::{ends_with, fixture};

#[test]
fn m4_a_stop_while_idle_releases_every_hold_with_no_further_call() {
    let mut f = fixture(r#","stop_chord_after_posts":1"#, None);
    f.grant();
    let _ = f.call(Method::KeyDown, json!({"target": "101", "chord": "shift"}));
    assert_eq!(f.session.funnel.control.holds.held(), vec![Held::Key { key: "shift".to_owned() }], "the press went out");
    let wait = f.session.hold_wait().expect("a live hold");
    assert!(wait.as_millis() <= u128::from(PAUSE_TICK_MS), "the idle loop wakes within a tick to see a stop: {wait:?}");
    f.session.release_due_holds();
    assert!(ends_with(f.inputs().last().expect("posts"), "key \"shift\" down=false"), "{:?}", f.inputs());
    assert!(f.session.funnel.control.holds.held().is_empty(), "{:?}", f.session.funnel.control.holds.held());
}

#[test]
fn l7_a_bounded_button_hold_keeps_an_earlier_hold_of_the_same_button() {
    let mut f = fixture("", None);
    f.grant();
    let frame = f.frame();
    f.call(Method::MouseDown, json!({"target": "101", "x": 30, "y": 40, "frameId": frame})).expect("mouse.down");
    let frame = f.frame();
    f.call(Method::HoldMouse, json!({"target": "101", "x": 50, "y": 50, "duration": 0, "frameId": frame})).expect("holdMouse");
    let held = f.session.funnel.control.holds.held();
    assert_eq!(held.len(), 1, "{held:?}");
    assert!(matches!(&held[0], Held::Button { origin, .. } if (origin.x, origin.y) == (30.0, 40.0)), "{held:?}");
}

#[test]
fn l8_a_hold_reaching_the_bound_during_a_long_bounded_hold_is_released_then() {
    let mut f = fixture("", None);
    f.grant();
    f.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect("shift down");
    f.clock.advance(1_000);
    f.call(Method::HoldKeys, json!({"target": "101", "keys": ["a"], "duration": MAX_HOLD_MS})).expect("holdKeys");
    let inputs = f.inputs();
    let shift_up = inputs.iter().position(|l| ends_with(l, "key \"shift\" down=false")).expect("shift released at its bound");
    let a_up = inputs.iter().position(|l| ends_with(l, "key \"a\" down=false")).expect("a released at the end");
    assert!(shift_up < a_up, "shift came up at its bound, before the long hold ended: {inputs:?}");
}

#[test]
fn l9_a_release_the_backend_refuses_stays_held_for_the_next_exit_path() {
    let mut f = fixture("", Some(1));
    f.grant();
    f.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect("shift down");
    let first = f.session.funnel.control.holds.release_all(f.session.backend.as_mut());
    assert_eq!((first.count, first.of), (0, 1), "the release post was refused");
    assert_eq!(f.session.funnel.control.holds.held(), vec![Held::Key { key: "shift".to_owned() }], "kept for a retry");
    let second = f.session.funnel.control.holds.release_all(f.session.backend.as_mut());
    assert_eq!((second.count, second.of), (1, 1));
    assert!(f.session.funnel.control.holds.held().is_empty());
}
