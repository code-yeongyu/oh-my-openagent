//! `apps.quit` on the fake (row 24).

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::methods::Method;
use serde_json::json;

use crate::Session;

const SCENARIO: &str = include_str!("../../../omo-computer-backend-fake/fixtures/v3-apps.json");

fn session() -> (Session, RecordingSink) {
    session_on(SCENARIO)
}

fn session_on(scenario: &str) -> (Session, RecordingSink) {
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::from_json(scenario).expect("scenario"), FakeClock::default(), sink.clone())
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
fn an_unknown_app_is_refused_with_nothing_sent() {
    let (mut session, sink) = session();
    let refused = session.host_call(Method::AppsQuit, json!({"target": "NoSuchApp"})).expect("served").expect_err("no window");
    assert!(format!("{refused:?}").contains("InvalidTarget"), "{refused:?}");
    assert!(sink.lines().iter().all(|line| !line.contains("app_quit")));
}

/// Review M1 of #13359: an installed app that is not running was never seen running, so "no
/// window after the quit" proves nothing; the quit is not confirmed.
#[test]
fn quitting_an_app_that_is_not_running_is_not_confirmed() {
    let (mut session, _sink) = session();
    let report = session.host_call(Method::AppsQuit, json!({"target": "com.example.mail"})).expect("served").expect("quit");
    assert_ne!(report["effect"], json!("confirmed"), "{report}");
    assert_ne!(report["disposition"]["delivery"], json!("delivered_verified"), "{report}");
}

/// Review L2 of #13359: a running app with no window has no window to see disappear; the quit
/// is not confirmed, and no baseline the session never read is reported.
#[test]
fn quitting_a_running_app_with_no_window_is_not_confirmed() {
    let mut scenario: serde_json::Value = serde_json::from_str(SCENARIO).expect("scenario json");
    scenario["windows"] = json!([]);
    scenario["ax"] = json!({});
    let (mut session, _sink) = session_on(&scenario.to_string());
    let report = session.host_call(Method::AppsQuit, json!({"target": "com.example.notes"})).expect("served").expect("quit");
    assert_ne!(report["effect"], json!("confirmed"), "{report}");
    assert!(report["evidence"].as_array().is_none_or(|e| e.iter().all(|ev| ev["baseline"] != json!("running"))), "{report}");
}
