use std::sync::{Arc, Mutex, PoisonError};

use omo_computer_core::backend::Backend;
use serde_json::{json, Value};

use super::{click, params, wire, Probe, Run};

#[test]
fn marker_written_before_first_sink_line() {
    let run = Run::new();
    let file = run.marker_file();
    let seen: Arc<Mutex<Vec<Option<String>>>> = Arc::default();
    let log = Arc::clone(&seen);
    let sink = run.sink.clone();
    let backend = Probe::new(
        run.fake(),
        Box::new(move |inner, input, route| {
            if sink.is_empty() {
                log.lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(std::fs::read_to_string(&file).ok());
            }
            inner.post_input(input, route)
        }),
    );
    let mut session = run.session(Box::new(backend));
    session.click(click("c-before")).expect("delivered");
    let seen = seen.lock().unwrap_or_else(PoisonError::into_inner).clone();
    assert_eq!(seen.len(), 1, "exactly one first sink line: {seen:?}");
    let text = seen[0]
        .as_deref()
        .expect("the marker existed when the first sink line was written");
    let marker: Value = serde_json::from_str(text).expect("marker JSON");
    assert_eq!(marker["binding"]["callId"], json!("c-before"));
    assert_eq!(marker["binding"]["issuer"], json!("local"));
    assert_eq!(marker["binding"]["scope"], json!("default"));
    assert!(marker["binding"]["runGeneration"].is_u64(), "{marker}");
    assert_eq!(run.sink.len(), 3, "move, down, up: {:?}", run.sink.lines());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(run.marker_file())
            .expect("marker")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn marker_unavailable_refuses_with_nothing_sent() {
    let run = Run::new();
    std::fs::write(
        run.dir.path().join("markers"),
        b"a file where the markers dir goes",
    )
    .expect("seed");
    let mut session = run.session(Box::new(run.fake()));
    let clicked = session.click(click("c-unavailable")).expect_err("refused");
    let typed = session
        .type_text(params(json!({ "target": "101", "text": "hi" })))
        .expect_err("refused");
    for refused in [clicked, typed] {
        assert_eq!(
            wire(&refused),
            ("TransactionFailed", Some("marker_unavailable"))
        );
        assert_eq!(
            refused.refusal.computer_code().map(|code| code.wire()),
            Ok("COMPUTER_TRANSACTION_FAILED")
        );
    }
    assert!(run.sink.is_empty(), "nothing sent: {:?}", run.sink.lines());
    let refusals: Vec<Value> = run
        .audit_lines()
        .into_iter()
        .filter(|line| line["gate"]["reason"] == json!("marker_unavailable"))
        .collect();
    assert_eq!(refusals.len(), 2, "one refused line per call");
}

#[test]
fn replayed_call_is_refused_local_transport() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    session
        .click(click("c-replay"))
        .expect("first send delivered");
    assert_eq!(run.sink.len(), 3);
    let replay = session
        .click(click("c-replay"))
        .expect_err("the replay is refused");
    assert_eq!(wire(&replay), ("TransactionFailed", Some("replayed")));
    assert_eq!(
        replay.refusal.computer_code().map(|code| code.wire()),
        Ok("COMPUTER_REPLAYED")
    );
    assert_eq!(replay.call_id.as_deref(), Some("c-replay"));
    assert_eq!(
        replay.receipt.as_deref(),
        Some(&Value::Null),
        "the stored null-mode reply"
    );
    assert_eq!(run.sink.len(), 3, "nothing sent on the replay");
    drop(session);
    let mut restarted = run.session(Box::new(run.fake()));
    let again = restarted
        .click(click("c-replay"))
        .expect_err("a restarted engine refuses it too");
    assert_eq!(wire(&again), ("TransactionFailed", Some("replayed")));
    restarted
        .click(click("c-next"))
        .expect("a new callId is delivered");
    assert_eq!(run.sink.len(), 6);
    assert_eq!(run.marker()["binding"]["callId"], json!("c-next"));
}

#[test]
fn gate_refusal_is_one_audit_line_and_nothing_sent() {
    let run = Run::new();
    let mut session = crate::Session::for_roots(Box::new(run.fake()), &run.roots());
    session.open(params(json!({}))).expect("open");
    let refused = session
        .click(click("c-no-stop-path"))
        .expect_err("no stop path armed");
    assert_eq!(refused.refusal.code.wire(), "StopPathUnavailable");
    assert!(run.sink.is_empty());
    assert!(
        !run.marker_file().exists(),
        "a refused call writes no marker"
    );
    let lines: Vec<Value> = run
        .audit_lines()
        .into_iter()
        .filter(|line| line.get("kind").is_none())
        .collect();
    assert_eq!(lines.len(), 1, "one line per gate outcome: {lines:?}");
    assert_eq!(lines[0]["gate"]["outcome"], json!("refused"));
    assert_eq!(lines[0]["status"], json!("refused"));
    assert_eq!(lines[0]["callId"], json!("c-no-stop-path"));
}
