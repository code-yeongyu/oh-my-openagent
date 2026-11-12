//! Drags and scrolls on the fake: every drag point checked before the press, the frame consumed
//! once at completion, a drag stopped mid-way released at its origin, bounded counted scrolls.

use omo_computer_core::methods::Method;
use serde_json::json;

use super::{ends_with, fixture, reason};

const TWO: &str = r#","windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null},{"id":"202","title":"vault","app":"1password","pid":5151,"x":820,"y":0,"width":400,"height":600,"focused":false,"elevated":null}]"#;

#[test]
fn drag_consumes_frame_once_at_completion() {
    let mut f = fixture("", None);
    f.grant();
    let frame = f.frame();
    let drag = json!({"target": "101", "from": {"x": 10, "y": 10}, "to": {"x": 100, "y": 80}, "path": [{"x": 50, "y": 40}], "frameId": frame});
    f.call(Method::Drag, drag.clone()).expect("first drag");
    let inputs = f.inputs();
    assert!(inputs.iter().any(|l| ends_with(l, "button left down=true")) && ends_with(inputs.last().expect("posts"), "button left down=false"), "{inputs:?}");
    let before = f.inputs().len();
    assert!(f.call(Method::Drag, drag).is_err(), "the frame was consumed once");
    assert_eq!(f.inputs().len(), before, "nothing sent on the consumed frame");
}

#[test]
fn stop_mid_drag_releases_at_the_origin() {
    let mut f = fixture("", Some(3));
    f.grant();
    let frame = f.frame();
    let drag = json!({"target": "101", "from": {"x": 10, "y": 10}, "to": {"x": 300, "y": 300}, "path": [{"x": 60, "y": 60}, {"x": 120, "y": 120}], "frameId": frame});
    assert!(f.call(Method::Drag, drag).is_err(), "the route stops after the first path point");
    let inputs = f.inputs();
    let tail: Vec<&String> = inputs.iter().rev().take(2).collect();
    assert!(ends_with(tail[1], "pointer_move x=10 y=10") && ends_with(tail[0], "button left down=false"), "{inputs:?}");
    assert!(!inputs.iter().any(|l| ends_with(l, "pointer_move x=120 y=120")), "nothing at the interrupted point: {inputs:?}");
}

#[test]
fn drag_drop_onto_a_denied_app_is_refused_with_nothing_pressed() {
    let mut f = fixture(TWO, None);
    f.grant();
    let refused = f.call(Method::Drag, json!({"target": "desktop", "from": {"x": 10, "y": 10}, "to": {"x": 900, "y": 100}})).expect_err("denied drop");
    assert_eq!(reason(&refused), ("InvalidTarget", Some("drag_destination")));
    assert!(f.inputs().is_empty(), "nothing pressed: {:?}", f.inputs());
}

#[test]
fn window_drag_to_a_point_outside_the_frame_resolves_the_destination() {
    let mut f = fixture(TWO, None);
    f.grant();
    let refused = f.call(Method::Drag, json!({"target": "101", "from": {"x": 10, "y": 10}, "to": {"x": 900, "y": 100}})).expect_err("resolved outside");
    assert_eq!(reason(&refused), ("InvalidTarget", Some("drag_destination")));
    assert!(f.inputs().is_empty(), "{:?}", f.inputs());
}

#[test]
fn scroll_steps_bounded_and_counted() {
    let mut f = fixture("", None);
    f.grant();
    f.frame();
    let report = f.call(Method::Scroll, json!({"target": "101", "x": 50, "y": 50, "clicks": 3, "direction": "down"})).expect("scroll");
    assert_eq!(report["delivered"], json!({"count": 4, "of": 4}), "the move and three counted steps");
    assert_eq!(f.inputs().iter().filter(|l| l.contains(" scroll ")).count(), 3);
    let before = f.inputs().len();
    let refused = f.call(Method::Scroll, json!({"target": "101", "x": 50, "y": 50, "clicks": 1001, "direction": "down"})).expect_err("past 1000");
    assert_eq!(reason(&refused), ("Internal", Some("scroll_steps")));
    assert_eq!(refused.detail.as_deref().map(|d| d["field"].clone()), Some(json!("clicks")));
    assert_eq!(f.inputs().len(), before, "refused before send");

    let mut capped = fixture(r#","scroll_cap":2"#, None);
    capped.grant();
    capped.frame();
    let report = capped.call(Method::Scroll, json!({"target": "101", "x": 50, "y": 50, "clicks": 5, "direction": "down"})).expect("capped scroll");
    assert_eq!((report["effect"].clone(), report["delivered"].clone()), (json!("partial"), json!({"count": 3, "of": 6})));
    let click = capped.session.host_call(Method::Move, json!({"target": "101", "x": 5, "y": 5})).expect("served").expect("move");
    assert_eq!(click["delivered"], json!({"count": 1, "of": 1}), "a single-unit event still counts 1 of 1");
}
