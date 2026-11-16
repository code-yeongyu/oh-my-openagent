//! `ax.typeText` on the fake (row 24): a native text field takes the text by insertion, any other
//! element is focused and takes keys, and an insertion the app does not answer is `AxUnconfirmed`
//! yet lands (the imported `ax-type-text` case's behaviour, by row 24's own test).

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::methods::Method;
use serde_json::{json, Value};

use crate::Session;

const SCENARIO: &str = include_str!("../../../omo-computer-backend-fake/fixtures/ax-type-text.json");

fn session(cannot_complete: bool) -> (Session, RecordingSink) {
    let mut scenario: Value = serde_json::from_str(SCENARIO).expect("scenario json");
    if !cannot_complete {
        scenario.as_object_mut().expect("object").remove("ax_cannot_complete");
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

#[test]
fn a_text_field_takes_the_text_by_insertion_and_it_reads_back() {
    let (mut session, sink) = session(false);
    let reply = session.host_call(Method::AxTypeText, json!({"ref": "e2", "text": "hello"})).expect("served").expect("typeText");
    assert_eq!(reply, json!({"method": "inserted"}));
    assert!(sink.lines().iter().any(|line| line.starts_with("ax_type_text") && line.ends_with("chars=5")), "{:?}", sink.lines());
}

#[test]
fn a_non_text_element_is_focused_and_takes_keys() {
    let (mut session, sink) = session(false);
    let reply = session.host_call(Method::AxTypeText, json!({"ref": "e3", "text": "ok"})).expect("served").expect("typeText");
    assert_eq!(reply, json!({"method": "keys"}));
    assert!(sink.lines().iter().any(|line| line.starts_with("ax_focus")), "{:?}", sink.lines());
}

#[test]
fn an_unanswered_insertion_is_ax_unconfirmed_and_lands() {
    let (mut session, sink) = session(true);
    let refused = session.host_call(Method::AxTypeText, json!({"ref": "e2", "text": "draft"})).expect("served").expect_err("unanswered");
    assert!(format!("{refused:?}").contains("AxUnconfirmed"), "{refused:?}");
    assert!(sink.lines().iter().any(|line| line.starts_with("ax_type_text") && line.ends_with("chars=5")), "the write landed: {:?}", sink.lines());
}
