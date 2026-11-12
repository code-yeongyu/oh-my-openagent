//! Gate review a3: no fallible result of the funnel is dropped. A failing audit append on a
//! refusal or a partial-send path answers `write_failed`; a failing marker clear and an
//! unserialisable receipt are logged; a call that finds no exec permit free is refused with
//! nothing sent.

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use omo_computer_core::backend::{Backend, Refusal};
use omo_computer_core::error::EngineCode;
use omo_computer_core::report::Disposition;
use serde::ser::{Error as _, Serialize, Serializer};
use serde_json::Value;

use super::{click, wire, Probe, Run};
use crate::audit::{AuditEvent, AuditSink};
use crate::budget::PermitKind;
use crate::marker::{MarkerRead, MarkerStore, MemoryMarkers, PreInputMarker};

/// An audit whose admission passes and whose every append fails, as a disk filling mid-run.
pub(super) struct FailingAppend;

impl AuditSink for FailingAppend {
    fn admit(&self) -> Result<(), Refusal> {
        Ok(())
    }

    fn append(&mut self, _event: AuditEvent) -> io::Result<String> {
        Err(io::Error::other("disk full"))
    }

    fn path(&self) -> Option<&Path> {
        None
    }
}

/// Markers whose clear always fails.
#[derive(Default)]
pub(super) struct FailingClear(MemoryMarkers);

impl MarkerStore for FailingClear {
    fn read(&self, issuer: &str, scope: &str) -> MarkerRead {
        self.0.read(issuer, scope)
    }

    fn create(&mut self, marker: &PreInputMarker) -> io::Result<()> {
        self.0.create(marker)
    }

    fn record_receipt(&mut self, marker: &PreInputMarker) -> io::Result<()> {
        self.0.record_receipt(marker)
    }

    fn clear(&mut self, _issuer: &str, _scope: &str) -> io::Result<()> {
        Err(io::Error::other("busy"))
    }
}

/// A backend that delivers `ok` events and refuses every later one.
fn refusing_after(run: &Run, ok: u32) -> Probe {
    let sent = Arc::new(AtomicU32::new(0));
    Probe::new(
        run.fake(),
        Box::new(move |inner, input, route| {
            if sent.fetch_add(1, Ordering::SeqCst) < ok {
                inner.post_input(input, route)
            } else {
                Err(Refusal::bare(EngineCode::InputFailed))
            }
        }),
    )
}

#[test]
fn audit_append_failure_on_a_refusal_answers_write_failed() {
    let run = Run::new();
    let mut session = run.session(Box::new(refusing_after(&run, 0)));
    session.funnel.audit = Some(Box::new(FailingAppend));
    let refused = session
        .click(click("c-refused"))
        .expect_err("the backend refused");
    assert_eq!(wire(&refused), ("InputFailed", None));
    assert_eq!(refused.warning.as_deref(), Some("write_failed"));
    assert!(
        session
            .funnel
            .warned
            .iter()
            .any(|line| line.contains("audit")),
        "{:?}",
        session.funnel.warned
    );
}

#[test]
fn audit_append_failure_on_a_partial_send_answers_write_failed() {
    let run = Run::new();
    let mut session = run.session(Box::new(refusing_after(&run, 1)));
    session.funnel.audit = Some(Box::new(FailingAppend));
    let refused = session
        .click(click("c-partial"))
        .expect_err("refused mid-send");
    assert_eq!(refused.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    assert_eq!(refused.warning.as_deref(), Some("write_failed"));
}

#[test]
fn a_failing_marker_clear_after_a_zero_send_refusal_is_logged_and_stays_closed() {
    let run = Run::new();
    let mut session = run.session(Box::new(refusing_after(&run, 0)));
    session.funnel.markers = Box::new(FailingClear::default());
    session
        .click(click("c-clear"))
        .expect_err("the backend refused");
    assert!(
        session
            .funnel
            .warned
            .iter()
            .any(|line| line.contains("marker not cleared")),
        "{:?}",
        session.funnel.warned
    );
    let redrive = session
        .click(click("c-clear"))
        .expect_err("the kept marker refuses the re-drive");
    assert_eq!(redrive.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    assert!(run.sink.is_empty(), "nothing was ever sent");
}

#[test]
fn a_call_with_no_free_exec_permit_is_refused_with_nothing_sent() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    let permits = session.funnel.permits.clone();
    let held = permits
        .try_take(PermitKind::Exec)
        .expect("the one exec permit");
    let refused = session
        .click(click("c-permit"))
        .expect_err("no exec permit is free");
    drop(held);
    assert_eq!(wire(&refused), ("TransactionFailed", None));
    assert!(run.sink.is_empty(), "{:?}", run.sink.lines());
    assert!(!run.marker_file().exists(), "no marker was written");
}

struct Unserialisable;

impl Serialize for Unserialisable {
    fn serialize<S: Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
        Err(S::Error::custom("not serialisable"))
    }
}

#[test]
fn an_unserialisable_receipt_is_logged_not_stored_silently() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    assert_eq!(session.funnel.receipt_of(&Unserialisable), Value::Null);
    assert!(
        session
            .funnel
            .warned
            .iter()
            .any(|line| line.contains("receipt")),
        "{:?}",
        session.funnel.warned
    );
}
