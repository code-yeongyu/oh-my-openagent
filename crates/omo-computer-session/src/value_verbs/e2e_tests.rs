//! `ax.setValue` end to end on the fake, through the host-call route and the funnel.

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::methods::Method;
use serde_json::{json, Value};

use crate::Session;

const SCENARIO: &str = include_str!("../../../omo-computer-backend-fake/fixtures/ax-type-text.json");

fn session(readback: Option<Value>) -> (Session, RecordingSink) {
    let mut scenario: Value = serde_json::from_str(SCENARIO).expect("scenario json");
    if let (Some(base), Some(readback)) = (scenario.as_object_mut(), readback) {
        base.insert("value_readback".to_owned(), readback);
    }
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::from_value(&scenario).expect("scenario"), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
    session.host_call(Method::AxSnapshot, json!({"target": "101"})).expect("served").expect("snapshot");
    (session, sink)
}

fn set_value(session: &mut Session, value: &str) -> Value {
    session.host_call(Method::AxSetValue, json!({"ref": "e2", "value": value})).expect("served").expect("setValue")
}

#[test]
fn set_value_reads_back_equal_and_is_confirmed() {
    let (mut session, _) = session(None);
    let report = set_value(&mut session, "x");
    assert_eq!(report["effect"], json!("confirmed"), "{report}");
    assert_eq!(report["evidence"][0]["kind"], json!("value_readback"));
    assert_eq!(report["evidence"][0]["class"], json!("receipt"));
    assert_eq!(report["evidence"][0]["value"], json!("x"));
}

#[test]
fn set_value_read_back_different_is_observed_with_observe_next() {
    let (mut session, _) = session(Some(json!({"e2": "x!"})));
    let report = set_value(&mut session, "x");
    assert_eq!(report["effect"], json!("observed"), "{report}");
    assert_eq!(report["disposition"], json!({"delivery": "delivered_unverified", "retry": "unsafe"}));
    assert_eq!(report["evidence"][0]["class"], json!("observation"));
    assert_eq!((&report["evidence"][0]["intended"], &report["evidence"][0]["value"]), (&json!("x"), &json!("x!")));
    assert_eq!(report["nextCall"], json!("observe"));
    let again = set_value(&mut session, "x");
    assert_eq!(again["effect"], json!("observed"), "the generation stays valid: the next exec is admitted");
}

#[test]
fn set_value_unreadable_is_unverifiable() {
    let (mut session, _) = session(Some(json!({"e2": null})));
    let report = set_value(&mut session, "x");
    assert_eq!(report["effect"], json!("unverifiable"), "{report}");
    assert_eq!(report["nextCall"], json!("observe"));
}
