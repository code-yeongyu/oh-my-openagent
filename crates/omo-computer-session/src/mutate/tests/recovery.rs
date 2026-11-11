use std::panic::{self, AssertUnwindSafe};

use omo_computer_core::backend::Backend;
use omo_computer_core::report::Disposition;
use serde_json::{json, Value};

use super::{click, open, wire, Probe, Run};
use crate::Session;

/// A session whose engine dies after its last input event and before it replies.
fn die_after_input(run: &Run, call_id: &str, generation: u64) {
    let sink = run.sink.clone();
    let backend = Probe::new(
        run.fake(),
        Box::new(move |inner, input, route| {
            let sent = inner.post_input(input, route);
            assert!(
                sink.len() < 3,
                "the engine dies after the last event, before the reply"
            );
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
    assert!(
        pending.get("receipt").is_none(),
        "no reply was stored: {pending}"
    );

    let mut restarted = run.session(Box::new(run.fake()));
    let other = restarted
        .click(click("c-other"))
        .expect_err("a stale marker refuses another callId");
    assert_eq!(
        wire(&other),
        ("TransactionFailed", Some("recovery_required"))
    );
    assert_eq!(other.call_id.as_deref(), Some("c-kill"));
    let redrive = restarted
        .click(click("c-kill"))
        .expect_err("the re-drive refuses the act");
    assert_eq!(
        wire(&redrive),
        ("TransactionFailed", Some("recovery_required"))
    );
    assert_eq!(redrive.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    assert_eq!(
        run.sink.len(),
        3,
        "exactly one delivered input: nothing was resent"
    );
    assert!(
        !run.marker_file().exists(),
        "the refusal's audit line cleared the marker"
    );
    let recovered: Vec<Value> = run
        .audit_lines()
        .into_iter()
        .filter(|line| {
            line["callId"] == json!("c-kill") && line["warnings"] == json!(["marker_recovered"])
        })
        .collect();
    assert_eq!(recovered.len(), 1, "one recovery line");
    assert_eq!(
        recovered[0]["disposition"],
        json!({ "delivery": "delivery_uncertain", "retry": "unsafe" })
    );
    restarted
        .click(click("c-after"))
        .expect("the scope is free again");
    assert_eq!(run.sink.len(), 6);
}

#[test]
fn hello_generation_quarantines_stale_reply() {
    let run = Run::new();
    die_after_input(&run, "c-gen1", 1);
    let backend: Box<dyn Backend> = Box::new(run.fake());
    let mut restarted = open(Session::for_roots(backend, &run.roots()).with_generation(2));
    let redrive = restarted
        .click(click("c-gen1"))
        .expect_err("the generation-1 call never resolves as sent");
    assert_eq!(redrive.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    let quarantined: Vec<Value> = run
        .audit_lines()
        .into_iter()
        .filter(|line| {
            line["warnings"]
                .as_array()
                .is_some_and(|warnings| warnings.contains(&json!("quarantined_reply")))
        })
        .collect();
    assert_eq!(quarantined.len(), 1, "exactly one quarantined reply");
    assert_eq!(quarantined[0]["generation"], json!(2));
    assert_eq!(quarantined[0]["callId"], json!("c-gen1"));
    assert_eq!(run.sink.len(), 3, "nothing resent");
}

/// One crashed call: every later re-drive of its `callId` reads `delivery_uncertain/unsafe` and
/// sends nothing, across re-drives, restarts and other calls in the same scope.
#[test]
fn crashed_call_id_stays_poisoned_and_is_delivered_exactly_once() {
    let run = Run::new();
    die_after_input(&run, "c-crash", 1);
    assert_eq!(run.sink.len(), 3, "the crashed call's one delivery");
    let assert_poisoned = |session: &mut Session, expected_sink: usize| {
        let redrive = session.click(click("c-crash")).expect_err("a crashed callId is never resent");
        assert_eq!(wire(&redrive), ("TransactionFailed", Some("recovery_required")));
        assert_eq!(redrive.call_id.as_deref(), Some("c-crash"));
        assert_eq!(redrive.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
        assert_eq!(run.sink.len(), expected_sink, "nothing resent: {:?}", run.sink.lines());
    };
    let mut first = run.session(Box::new(run.fake()));
    assert_poisoned(&mut first, 3);
    assert_poisoned(&mut first, 3);
    drop(first);
    let mut restarted = run.session(Box::new(run.fake()));
    assert_poisoned(&mut restarted, 3);
    restarted.click(click("c-other")).expect("another callId is delivered once the scope is free");
    assert_eq!(run.sink.len(), 6);
    assert_poisoned(&mut restarted, 6);
    assert_poisoned(&mut restarted, 6);
}
