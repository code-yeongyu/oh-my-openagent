use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use serde_json::json;

use crate::Session;

fn session(scenario: &str) -> Session {
    let backend = FakeBackend::with_parts(FakeScenario::from_json(scenario).expect("scenario"), FakeClock::default(), RecordingSink::default())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session
}

const FIELDS: &str = include_str!("../../../omo-computer-backend-fake/fixtures/v3-secure-fields.json");
const SECURE_FOCUS: &str = include_str!("../../../omo-computer-backend-fake/fixtures/v3-secure-focus-observe.json");

#[test]
fn secure_field_value_is_withheld_from_the_tree() {
    let mut session = session(FIELDS);
    let observation = session.observe(serde_json::from_value(json!({"target": "101"})).expect("params")).expect("observe");
    let reply = serde_json::to_string(&observation).expect("json");
    assert!(reply.contains("cats"), "an ordinary value is kept: {reply}");
    for secret in ["hunter2", "s3cretValue"] {
        assert!(!reply.contains(secret), "secret {secret} reached the reply: {reply}");
    }
}

#[test]
fn secure_field_observe_withholds_tree_and_frame() {
    let mut session = session(SECURE_FOCUS);
    let observation = session.observe(serde_json::from_value(json!({"target": "101"})).expect("params")).expect("observe");
    assert_eq!(observation.secure, Some(true));
    assert_eq!((observation.tree.as_deref(), observation.frame.is_some(), observation.focused.is_some()), (None, false, false));
    let reply = serde_json::to_string(&observation).expect("json");
    for secret in ["hunter2", "s3cretValue", "cats"] {
        assert!(!reply.contains(secret), "{secret} reached a private-mode reply: {reply}");
    }
}
