//! A-IS-62 R7-2 at the session (release-gate item (6)'s property tests in this crate): a chord
//! refusal another process wrote to the hand's audit holds this process's hand tampered at its
//! start, at session open and at its next exec admission (read after the interaction lock is held):
//! exec is refused ControlRequired{tampered} with nothing sent; reads continue.

use super::{click, open, wire, Run};
use crate::audit::{AuditEvent, AuditLimits, AuditSink, AuditWriter, Gate, GateOutcome, Status, WriterId};
use crate::Session;

const OTHER: WriterId = WriterId {
    pid: 4_000_001,
    proc_start_ms: 9,
};

/// Another engine process of the user refuses a carried chord on the same hand (`local`).
fn another_process_refuses(run: &Run) {
    let mut other = AuditWriter::open(&run.dir.path().join("audit"), "local", 1, OTHER, AuditLimits::default())
        .expect("the other process's writer");
    other
        .append(AuditEvent {
            action: "stopPath.start".to_owned(),
            target: "stop_hotkey".to_owned(),
            gate: Gate {
                outcome: GateOutcome::Refused,
                stage: Some("Consent".to_owned()),
                code: Some("ControlRequired".to_owned()),
                reason: Some("tampered".to_owned()),
            },
            status: Status::Refused,
            primary_error: Some("ControlRequired".to_owned()),
            evidence: vec!["configured=ctrl+alt+shift+escape".to_owned(), "carried=ctrl+q".to_owned()],
            ..AuditEvent::default()
        })
        .expect("the refusal line");
}

#[test]
fn a_refusal_another_process_wrote_reads_tampered_at_session_open() {
    let run = Run::new();
    another_process_refuses(&run);
    let mut session = run.session(Box::new(run.fake()));
    let refused = session.click(click("c-open")).expect_err("the hand reads tampered");
    assert_eq!(wire(&refused), ("ControlRequired", Some("tampered")));
    assert!(run.sink.is_empty(), "nothing sent");
}

#[test]
fn a_refusal_written_after_open_reads_tampered_at_the_next_exec_admission() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    session.click(click("c-before")).expect("a healthy hand acts");
    let sent = run.sink.len();
    another_process_refuses(&run);
    let refused = session.click(click("c-after")).expect_err("the next admission reads it");
    assert_eq!(wire(&refused), ("ControlRequired", Some("tampered")));
    assert_eq!(run.sink.len(), sent, "nothing more sent");
    let _reads_continue = session.capabilities();
}

#[test]
fn a_refusal_another_process_wrote_holds_the_hand_tampered_from_engine_start() {
    let run = Run::new();
    another_process_refuses(&run);
    let mut session = Session::for_roots(Box::new(run.fake()), &run.roots());
    session.read_audit_at_start();
    assert!(session.funnel.control.chord_tamper.holds(None), "held tampered before any open");
    let mut session = open(session);
    let refused = session.click(click("c-start")).expect_err("tampered");
    assert_eq!(wire(&refused), ("ControlRequired", Some("tampered")));
}
