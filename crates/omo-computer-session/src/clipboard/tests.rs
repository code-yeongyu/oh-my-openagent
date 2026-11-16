//! Design row C10 on the fake: the clipboard refuses under a secure focus with nothing written,
//! `paste` restores the prior clipboard byte-equal, and a concealed prior clipboard is never read.

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::methods::Method;
use serde_json::{json, Value};

use crate::Session;

const SCENARIO: &str = include_str!("../../../omo-computer-backend-fake/fixtures/ax-type-text.json");

fn session(extra: Value) -> (Session, RecordingSink) {
    let mut scenario: Value = serde_json::from_str(SCENARIO).expect("scenario json");
    let base = scenario.as_object_mut().expect("object");
    for (key, value) in extra.as_object().expect("extra").clone() {
        base.insert(key, value);
    }
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::from_value(&scenario).expect("scenario"), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
    session.control_grant(serde_json::from_value(json!({"reason": "test"})).expect("grant"));
    (session, sink)
}

fn clipboard_writes(sink: &RecordingSink) -> Vec<String> {
    sink.lines().into_iter().filter(|line| line.starts_with("clipboard_write")).collect()
}

#[test]
fn clipboard_refused_under_secure_focus() {
    let (mut session, sink) = session(json!({"secure_focus": {"window": "101", "role": "AXSecureTextField"}, "clipboard": {"text": "prior"}}));
    for (method, params) in [(Method::ClipboardRead, json!({})), (Method::ClipboardWrite, json!({"text": "x"})), (Method::Paste, json!({"target": "101", "text": "x"}))] {
        let report = session.host_call(method, params).expect("served").expect("a refused report, not an error");
        assert_eq!(report["effect"], json!("refused"), "{method:?}: {report}");
        assert_eq!((&report["reason"], &report["nothingSent"]), (&json!("secure_focus"), &json!(true)), "{method:?}");
        assert_eq!(report["disposition"], json!({"delivery": "not_delivered", "retry": "after_user"}));
    }
    assert!(clipboard_writes(&sink).is_empty(), "nothing written: {:?}", sink.lines());
}

#[test]
fn paste_restores_prior_clipboard() {
    let (mut session, sink) = session(json!({"clipboard": {"text": "prior"}}));
    session.host_call(Method::Paste, json!({"target": "101", "text": "hello"})).expect("served").expect("paste");
    let writes = clipboard_writes(&sink);
    assert_eq!(writes.len(), 2, "{writes:?}");
    assert!(writes[1].contains("prior"), "the prior clipboard, byte-equal, is put back last: {writes:?}");
    let read = session.host_call(Method::ClipboardRead, json!({})).expect("served").expect("read");
    assert_eq!(read["text"], json!("prior"));
}

#[test]
fn paste_over_a_concealed_clipboard_does_not_read_it() {
    let (mut session, sink) = session(json!({"clipboard": {"text": "secret", "concealed": true}}));
    let report = session.host_call(Method::Paste, json!({"target": "101", "text": "hello"})).expect("served").expect("paste");
    assert!(report.get("reason").is_none() && report.get("nothingSent").is_none(), "a report that is not refused carries neither: {report}");
    assert_eq!(report["note"], json!("clipboardRestored:false, reason:\"concealed\""), "{report}");
    let writes = clipboard_writes(&sink);
    assert_eq!(writes.len(), 1, "no restore: {writes:?}");
    assert!(sink.lines().iter().all(|line| !line.contains("secret")), "the concealed text never surfaces: {:?}", sink.lines());
}
