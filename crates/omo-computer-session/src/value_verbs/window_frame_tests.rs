//! Design row C8 on the fake (`frame_verbs_corpus`), through the host-call route.

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::methods::Method;
use serde_json::{json, Value};

use crate::Session;

const SCENARIO: &str = include_str!("../../../omo-computer-backend-fake/fixtures/ax-type-text.json");

fn session(policy: Value) -> (Session, RecordingSink) {
    let mut scenario: Value = serde_json::from_str(SCENARIO).expect("scenario json");
    scenario.as_object_mut().expect("object").insert("window_frame_policy".to_owned(), json!({ "101": policy }));
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::from_value(&scenario).expect("scenario"), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
    (session, sink)
}

fn call(session: &mut Session, method: Method, params: Value) -> Result<Value, String> {
    match session.host_call(method, params).expect("served") {
        Ok(value) => Ok(value),
        Err(error) => Err(format!("{error:?}")),
    }
}

#[test]
fn set_frame_within_1px_is_confirmed_with_a_frame_receipt() {
    let (mut session, _) = session(json!({}));
    let report = call(&mut session, Method::WindowSetFrame, json!({"target": "101", "x": 40, "y": 50, "width": 600, "height": 400})).expect("setFrame");
    assert_eq!(report["effect"], json!("confirmed"), "{report}");
    assert_eq!((&report["evidence"][0]["kind"], &report["evidence"][0]["class"]), (&json!("frame_readback"), &json!("receipt")));
}

#[test]
fn a_width_keeping_app_reports_partial_kept_width() {
    let (mut session, _) = session(json!({"keep": ["width"]}));
    let report = call(&mut session, Method::WindowSetFrame, json!({"target": "101", "width": 300})).expect("setFrame");
    assert_eq!(report["effect"], json!("partial"), "{report}");
    assert_eq!(report["evidence"][0]["class"], json!("observation"));
}

#[test]
fn a_non_settable_window_is_window_immovable_with_an_empty_sink() {
    let (mut session, sink) = session(json!({"settable": false}));
    let refused = call(&mut session, Method::WindowSetFrame, json!({"target": "101", "x": 5, "y": 5})).expect_err("immovable");
    assert!(refused.contains("window_immovable"), "{refused}");
    assert!(sink.lines().iter().all(|line| !line.starts_with("set_frame")), "nothing sent: {:?}", sink.lines());
}

#[test]
fn restore_without_the_lease_is_control_required() {
    let (mut session, _) = session(json!({}));
    let refused = call(&mut session, Method::WindowRestore, json!({"target": "101"})).expect_err("no lease");
    assert!(refused.contains("ControlRequired"), "{refused}");
}
