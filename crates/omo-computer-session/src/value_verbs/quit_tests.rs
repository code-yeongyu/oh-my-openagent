//! `apps.quit` on the fake (row 24).

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::methods::Method;
use serde_json::json;

use crate::Session;

const SCENARIO: &str = include_str!("../../../omo-computer-backend-fake/fixtures/v3-apps.json");

fn session() -> (Session, RecordingSink) {
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::from_json(SCENARIO).expect("scenario"), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
    (session, sink)
}

#[test]
fn quitting_an_app_is_confirmed_when_its_windows_are_gone() {
    let (mut session, sink) = session();
    let report = session.host_call(Method::AppsQuit, json!({"target": "com.example.notes"})).expect("served").expect("quit");
    assert_eq!(report["effect"], json!("confirmed"), "{report}");
    assert_eq!((&report["evidence"][0]["intended"], &report["evidence"][0]["value"]), (&json!("exited"), &json!("exited")));
    assert!(sink.lines().iter().any(|line| line.ends_with(r#"app_quit "com.example.notes" force=false"#)), "{:?}", sink.lines());
}

#[test]
fn an_app_with_no_window_is_refused_with_nothing_sent() {
    let (mut session, sink) = session();
    let refused = session.host_call(Method::AppsQuit, json!({"target": "NoSuchApp"})).expect("served").expect_err("no window");
    assert!(format!("{refused:?}").contains("InvalidTarget"), "{refused:?}");
    assert!(sink.lines().iter().all(|line| !line.contains("app_quit")));
}
