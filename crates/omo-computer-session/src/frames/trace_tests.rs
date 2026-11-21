//! The trace a real session writes (`false`, `true`, `"full"`), including the frame the
//! traced click consumed.

use std::fs;
use std::path::Path;

use omo_computer_backend_fake::{
    FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript,
};
use omo_computer_core::params::SessionOpenParams;
use omo_computer_core::paths::Roots;
use serde_json::{json, Value};

use crate::audit::gc::SESSIONS_DIR;
use crate::Session;

const SCENARIO: &str =
    include_str!("../../../omo-computer-backend-fake/fixtures/two-displays-one-window.json");

fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

/// One engine session opened with `trace`: a capture, one click, then close.
fn run(trace: Value) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let roots = Roots {
        state: dir.path().to_owned(),
        runtime: dir.path().to_owned(),
    };
    let scenario = FakeScenario::from_json(SCENARIO).expect("scenario");
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), RecordingSink::default())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::for_roots(Box::new(backend), &roots);
    let open: SessionOpenParams = params(json!({ "trace": trace }));
    session.open(open).expect("open");
    session.stop_path_start(params(json!({})));
    session.capture_frame("101", true, None).expect("a frame");
    session
        .click(params(json!({"target": "101", "x": 10, "y": 10})))
        .expect("delivered");
    session.close();
    dir
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[test]
fn trace_full_literal_accepted_true_is_jsonl_only() {
    let jsonl_run = run(json!(true));
    let artifacts = jsonl_run.path().join("artifacts");
    let listed = names(&artifacts);
    let jsonl: Vec<&String> = listed
        .iter()
        .filter(|name| name.ends_with(".jsonl"))
        .collect();
    assert_eq!(jsonl.len(), 1, "{listed:?}");
    assert!(
        !artifacts.join(SESSIONS_DIR).exists(),
        "true writes no session dir: {listed:?}"
    );
    let text = fs::read_to_string(artifacts.join(jsonl[0])).expect("the JSONL trace");
    let lines: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).expect("a JSON line"))
        .collect();
    assert_eq!(lines.len(), 1, "{text}");
    assert_eq!(lines[0]["method"], json!("click"));

    let full_run = run(json!("full"));
    let artifacts = full_run.path().join("artifacts");
    assert!(names(&artifacts)
        .iter()
        .all(|name| !name.ends_with(".jsonl")));
    let sessions = artifacts.join(SESSIONS_DIR);
    let ids = names(&sessions);
    assert_eq!(ids.len(), 1, "{ids:?}");
    let session_dir = sessions.join(&ids[0]);
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(session_dir.join("manifest.json")).expect("manifest"),
    )
    .expect("manifest JSON");
    let mut members: Vec<&str> = manifest
        .as_object()
        .expect("an object")
        .keys()
        .map(String::as_str)
        .collect();
    members.sort_unstable();
    assert_eq!(
        members,
        [
            "artifacts",
            "created_at",
            "cursor_overlay",
            "ended_at",
            "id",
            "trace"
        ]
    );
    assert_eq!(manifest["trace"], json!("full"));
    assert_eq!(manifest["id"], json!(ids[0]));
    assert!(
        manifest["ended_at"].is_string(),
        "close sets ended_at: {manifest}"
    );
    assert_eq!(
        manifest["artifacts"],
        json!(["turn-00001/action.json", "turn-00001/frame.png"])
    );
    let action: Value = serde_json::from_str(
        &fs::read_to_string(session_dir.join("turn-00001/action.json")).expect("action.json"),
    )
    .expect("action JSON");
    assert_eq!(action["method"], json!("click"));
    assert!(session_dir.join("turn-00001/frame.png").exists());
}

#[test]
fn trace_off_writes_nothing() {
    let off = run(json!(false));
    let listed = names(&off.path().join("artifacts"));
    assert!(
        listed
            .iter()
            .all(|name| !name.ends_with(".jsonl") && name != SESSIONS_DIR),
        "{listed:?}"
    );
}
