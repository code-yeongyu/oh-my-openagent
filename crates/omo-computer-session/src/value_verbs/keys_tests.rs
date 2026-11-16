//! Row 24's key verbs and `ax.perform` on the fake.

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::methods::Method;
use serde_json::json;

use crate::Session;

const SCENARIO: &str = include_str!("../../../omo-computer-backend-fake/fixtures/ax-type-text.json");

fn session() -> (Session, RecordingSink) {
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::from_json(SCENARIO).expect("scenario"), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
    (session, sink)
}

fn keys(sink: &RecordingSink) -> Vec<String> {
    sink.lines().into_iter().filter(|line| line.contains(" key ")).filter_map(|line| line.split_once(" key ").map(|(_, key)| key.to_owned())).collect()
}

#[test]
fn key_chord_press_and_release_are_paired() {
    let (mut session, sink) = session();
    session.host_call(Method::Press, json!({"chord": "ctrl+shift+t", "target": "101"})).expect("served").expect("press");
    assert_eq!(
        keys(&sink),
        ["\"ctrl\" down=true", "\"shift\" down=true", "\"t\" down=true", "\"t\" down=false", "\"shift\" down=false", "\"ctrl\" down=false"],
        "down in order, up in reverse: {:?}",
        sink.lines()
    );
}

#[test]
fn perform_reports_the_action_named() {
    let (mut session, sink) = session();
    session.host_call(Method::AxSnapshot, json!({"target": "101"})).expect("served").expect("snapshot");
    let report = session.host_call(Method::AxPerform, json!({"ref": "e3", "action": "press"})).expect("served");
    let performed: Vec<String> = sink.lines().into_iter().filter(|line| line.starts_with("ax_perform")).collect();
    assert_eq!(performed.len(), 1, "{performed:?}");
    assert!(performed[0].ends_with("action=press"), "the action named reaches the app: {performed:?}");
    if let Ok(report) = report {
        assert_ne!(report["effect"], json!("confirmed"), "a performed action is never confirmed from a read-back: {report}");
    }
}
