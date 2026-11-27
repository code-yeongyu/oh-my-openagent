//! The review of #13360 at 4acc6abf45: a stopped drag releases its button in null mode too (H1),
//! a refusal before any send records no hold (M1), a stop during a bounded hold ends it at once
//! (M2), the bound counts from the live press only (M3), a bounded call releases only what it
//! pressed (L1), a drag stopped after its button-up never releases the button again (L6), and the
//! real stop chord mid-drag releases at the origin in both report modes (L5).

use omo_computer_core::holds::{Held, MAX_HOLD_MS};
use omo_computer_core::methods::Method;
use serde_json::json;

use super::{ends_with, fixture, fixture_in, reason};

const DRAG: &str = r#"{"target": "101", "from": {"x": 10, "y": 10}, "to": {"x": 300, "y": 300}, "path": [{"x": 60, "y": 60}, {"x": 120, "y": 120}]}"#;

fn drag_params(f: &mut super::Fixture) -> serde_json::Value {
    let mut drag: serde_json::Value = serde_json::from_str(DRAG).expect("drag params");
    drag["frameId"] = json!(f.frame());
    drag
}

fn released_at_origin(inputs: &[String]) -> bool {
    let tail: Vec<&String> = inputs.iter().rev().take(2).collect();
    tail.len() == 2 && ends_with(tail[1], "pointer_move x=10 y=10") && ends_with(tail[0], "button left down=false")
}

#[test]
fn h1_a_null_mode_drag_stopped_after_its_press_releases_at_the_origin() {
    let mut f = fixture_in("null", "", Some(3));
    f.grant();
    assert!({ let d = drag_params(&mut f); f.call(Method::Drag, d) }.is_err(), "the route stops after the first path point");
    assert!(released_at_origin(&f.inputs()), "{:?}", f.inputs());
    assert!(f.session.funnel.control.holds.held().is_empty());
}

#[test]
fn m1_a_refusal_before_any_send_records_no_hold() {
    let mut f = fixture("", None);
    let refused = f.call(Method::MouseDown, json!({"target": "101", "x": 5, "y": 5})).expect_err("no lease");
    assert_eq!(reason(&refused).0, "ControlRequired");
    let refused = f.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect_err("no lease");
    assert_eq!(reason(&refused).0, "ControlRequired");
    assert!(f.session.funnel.control.holds.held().is_empty(), "{:?}", f.session.funnel.control.holds.held());
    assert_eq!(f.session.hold_wait(), None, "nothing held, no deadline");
}

#[test]
fn m2_a_stop_during_hold_keys_ends_the_hold_at_once() {
    let mut f = fixture(r#","stop_chord_after_posts":1"#, None);
    f.grant();
    let refused = f
        .call(Method::HoldKeys, json!({"target": "101", "keys": ["shift"], "duration": 50_000}))
        .expect_err("the stop ends the hold");
    assert_eq!(reason(&refused), ("Suspended", Some("hotkey")));
    assert!(f.clock.now_ms() < 2_000, "the hold did not run out its duration: {}", f.clock.now_ms());
    assert!(ends_with(f.inputs().last().expect("posts"), "key \"shift\" down=false"), "{:?}", f.inputs());
}

#[test]
fn m3_the_bound_counts_from_the_live_press_only() {
    let mut f = fixture("", None);
    f.grant();
    f.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect("first down");
    f.call(Method::KeyUp, json!({"target": "101", "chord": "shift"})).expect("up");
    f.clock.advance(10_000);
    f.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect("second down");
    let wait = f.session.hold_wait().expect("one live hold");
    assert_eq!(wait.as_millis(), u128::from(MAX_HOLD_MS), "the lifted press's deadline is gone");
}

#[test]
fn l1_a_bounded_hold_releases_only_what_it_pressed() {
    let mut f = fixture("", None);
    f.grant();
    f.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect("shift down");
    f.call(Method::HoldKeys, json!({"target": "101", "keys": ["a"], "duration": 0})).expect("holdKeys");
    assert!(!f.inputs().iter().any(|l| ends_with(l, "key \"shift\" down=false")), "{:?}", f.inputs());
    assert_eq!(f.session.funnel.control.holds.held(), vec![Held::Key { key: "shift".to_owned() }]);
}

#[test]
fn l6_a_drag_stopped_after_its_button_up_never_releases_the_button_again() {
    // move, shift down, button down, two moves, move to `to`, button up = 7 posts; refuse the 8th (shift up).
    let mut f = fixture("", Some(7));
    f.grant();
    let mut drag = drag_params(&mut f);
    drag["modifiers"] = json!(["shift"]);
    assert!(f.call(Method::Drag, drag).is_err(), "the modifier's key-up is refused");
    let ups = f.inputs().iter().filter(|l| ends_with(l, "button left down=false")).count();
    assert_eq!(ups, 1, "{:?}", f.inputs());
    assert!(f.session.funnel.control.holds.held().is_empty());
}

#[test]
fn l5_the_stop_chord_mid_drag_releases_at_the_origin_in_both_modes() {
    for mode in ["object", "null"] {
        let mut f = fixture_in(mode, r#","stop_chord_after_posts":3"#, None);
        f.grant();
        assert!({ let d = drag_params(&mut f); f.call(Method::Drag, d) }.is_err(), "{mode}: the stop chord ends the drag");
        assert!(released_at_origin(&f.inputs()), "{mode}: {:?}", f.inputs());
        assert!(f.session.funnel.control.holds.held().is_empty(), "{mode}");
    }
}
