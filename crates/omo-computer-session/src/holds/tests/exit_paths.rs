//! The exit-path ledger (design row C9): a held key comes up on each of the six exit paths the
//! session owns, and a key the user holds is never released synthetically.

use omo_computer_core::methods::Method;
use serde_json::json;

use super::{ends_with, fixture, reason, Fixture};

const SHIFT_UP: &str = "key \"shift\" down=false";

fn key_down(fixture: &mut Fixture) {
    fixture.grant();
    fixture.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect("key.down");
    assert!(ends_with(fixture.inputs().last().expect("a post"), "key \"shift\" down=true"), "{:?}", fixture.inputs());
}

fn released(fixture: &Fixture, path: &str) {
    let inputs = fixture.inputs();
    assert!(inputs.last().is_some_and(|line| ends_with(line, SHIFT_UP)), "{path}: {inputs:?}");
    assert_eq!(inputs.iter().filter(|line| ends_with(line, SHIFT_UP)).count(), 1, "{path}: one release, {inputs:?}");
}

#[test]
fn held_key_released_on_each_of_six_session_exit_paths() {
    let mut success = fixture("", None);
    success.grant();
    success.call(Method::HoldKeys, json!({"target": "101", "keys": ["shift"], "duration": 0})).expect("holdKeys");
    released(&success, "success");

    let mut error = fixture("", Some(1));
    error.grant();
    let refused = error.call(Method::HoldKeys, json!({"target": "101", "keys": ["shift", "b"], "duration": 0}));
    assert!(refused.is_err(), "the second press fails");
    released(&error, "error");

    let mut cancel = fixture("", None);
    key_down(&mut cancel);
    cancel.session.control_revoke();
    released(&cancel, "cancel (control.revoke)");

    let mut deadline = fixture("", None);
    key_down(&mut deadline);
    deadline.clock.advance(99_999);
    deadline.session.release_due_holds();
    assert!(!deadline.inputs().iter().any(|line| ends_with(line, SHIFT_UP)), "not before the bound");
    deadline.clock.advance(1);
    deadline.session.release_due_holds();
    released(&deadline, "deadline (100 s, no further call)");
    let up = deadline.call(Method::KeyUp, json!({"target": "101", "chord": "shift"})).expect("key.up after the bound");
    assert_eq!((up["effect"].clone(), up["delivered"].clone()), (json!("partial"), json!({"count": 0, "of": 1})));

    let mut stop = fixture("", None);
    key_down(&mut stop);
    stop.session.stop_path_stop(serde_json::from_value(json!({})).expect("stop params"));
    released(&stop, "stop");

    let mut close = fixture("", None);
    key_down(&mut close);
    close.session.close();
    released(&close, "connection close");
}

#[test]
fn a_key_the_user_holds_is_never_released_synthetically() {
    let mut held = fixture(r#","held_keys":["shift"]"#, None);
    key_down(&mut held);
    held.session.close();
    assert!(!held.inputs().iter().any(|line| ends_with(line, SHIFT_UP)), "{:?}", held.inputs());
}

#[test]
fn hold_requires_foreground_delivery() {
    let mut no_lease = fixture("", None);
    let refused = no_lease.call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect_err("no lease");
    assert_eq!(reason(&refused).0, "ControlRequired");
    assert!(no_lease.inputs().is_empty(), "{:?}", no_lease.inputs());
    let refused = no_lease.call(Method::MouseDown, json!({"target": "101", "x": 5, "y": 5})).expect_err("no lease");
    assert_eq!(reason(&refused).0, "ControlRequired");
    assert!(no_lease.inputs().is_empty(), "{:?}", no_lease.inputs());
}

#[test]
fn mouse_down_beyond_100_s_is_refused_and_released() {
    let mut over = fixture("", None);
    over.grant();
    for duration in [100_001_u64, u64::MAX] {
        let refused = over.call(Method::HoldMouse, json!({"target": "101", "x": 5, "y": 5, "duration": duration})).expect_err("past the bound");
        assert_eq!(reason(&refused), ("Internal", Some("hold_duration")));
        assert_eq!(refused.detail.as_deref().map(|d| d["field"].clone()), Some(json!("duration")));
    }
    assert!(over.inputs().is_empty(), "refused before send: {:?}", over.inputs());

    let mut reached = fixture("", None);
    reached.grant();
    let frame = reached.frame();
    reached.call(Method::MouseDown, json!({"target": "101", "x": 30, "y": 40, "frameId": frame})).expect("mouse.down");
    reached.call(Method::Move, json!({"target": "101", "x": 300, "y": 200})).expect("move away");
    reached.clock.advance(100_000);
    reached.session.release_due_holds();
    let inputs = reached.inputs();
    let tail: Vec<&String> = inputs.iter().rev().take(2).collect();
    assert!(ends_with(tail[1], "pointer_move x=30 y=40") && ends_with(tail[0], "button left down=false"), "warp to the origin, then up: {inputs:?}");
    let up = reached.call(Method::MouseUp, json!({"target": "101"})).expect("mouse.up after the bound");
    assert_eq!((up["effect"].clone(), up["delivered"].clone()), (json!("partial"), json!({"count": 0, "of": 1})));
}

#[test]
fn the_engine_session_releases_a_held_key_on_connection_close() {
    let dir = tempfile::tempdir().expect("tempdir");
    let sink = omo_computer_backend_fake::RecordingSink::default();
    let scenario = omo_computer_backend_fake::FakeScenario::from_json(&format!("{{{}}}", super::WINDOWS)).expect("scenario");
    let fake = omo_computer_backend_fake::FakeBackend::with_parts(scenario, omo_computer_backend_fake::FakeClock::default(), sink.clone())
        .with_stop_path(omo_computer_backend_fake::StopPathScript::Live);
    let roots = omo_computer_core::paths::Roots { state: dir.path().join("state"), runtime: dir.path().join("run") };
    let mut session = crate::Session::for_roots(Box::new(fake), &roots);
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
    session.control_grant(serde_json::from_value(json!({"reason": "test"})).expect("grant"));
    session.host_call(Method::KeyDown, json!({"target": "101", "chord": "shift"})).expect("served").expect("key.down");
    session.close();
    let posts: Vec<String> = sink.lines().into_iter().filter(|l| l.starts_with("post_input")).collect();
    assert!(posts.last().is_some_and(|l| ends_with(l, SHIFT_UP)), "the engine's close releases the key: {posts:?}");
}
