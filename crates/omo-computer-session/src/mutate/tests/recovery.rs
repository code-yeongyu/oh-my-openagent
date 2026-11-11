use std::panic::{self, AssertUnwindSafe};

use omo_computer_core::backend::Backend;
use omo_computer_core::report::Disposition;
use serde_json::{json, Value};

use super::{click, wire, Probe, Run};

/// A session whose engine dies after its last input event and before it replies.
fn die_after_input(run: &Run, call_id: &str, generation: u64) {
    let sink = run.sink.clone();
    let backend = Probe::new(
        run.fake(),
        Box::new(move |inner, input, route| {
            let sent = inner.post_input(input, route);
            assert!(sink.len() < 3, "the engine dies after the last event, before the reply");
            sent
        }),
    );
    let mut session = run.session(Box::new(backend));
    session = session.with_generation(generation);
    let killed = panic::catch_unwind(AssertUnwindSafe(|| session.click(click(call_id))));
    assert!(killed.is_err(), "the call never replied");
}

#[test]
fn kill_between_marker_and_reply_yields_one_delivered_input() {
    let run = Run::new();
    die_after_input(&run, "c-kill", 1);
    assert_eq!(run.sink.len(), 3, "the input went out once");
    let pending = run.marker();
    assert_eq!(pending["binding"]["callId"], json!("c-kill"));
    assert!(pending.get("receipt").is_none(), "no reply was stored: {pending}");

    let mut restarted = run.session(Box::new(run.fake()));
    let other = restarted.click(click("c-other")).expect_err("a stale marker refuses another callId");
    assert_eq!(wire(&other), ("TransactionFailed", Some("recovery_required")));
    assert_eq!(other.call_id.as_deref(), Some("c-kill"));
    let redrive = restarted.click(click("c-kill")).expect_err("the re-drive refuses the act");
    assert_eq!(wire(&redrive), ("TransactionFailed", Some("recovery_required")));
    assert_eq!(redrive.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    assert_eq!(run.sink.len(), 3, "exactly one delivered input: nothing was resent");
    assert!(!run.marker_file().exists(), "the refusal's audit line cleared the marker");
    let recovered: Vec<Value> = run
        .audit_lines()
        .into_iter()
        .filter(|line| line["callId"] == json!("c-kill") && line["warnings"] == json!(["marker_recovered"]))
        .collect();
    assert_eq!(recovered.len(), 1, "one recovery line");
    assert_eq!(recovered[0]["disposition"], json!({ "delivery": "delivery_uncertain", "retry": "unsafe" }));
    restarted.click(click("c-after")).expect("the scope is free again");
    assert_eq!(run.sink.len(), 6);
}

