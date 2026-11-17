//! The supervisor: the stop commit's release budget and fail-closed exit, and the latch.

use std::io;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use super::{Exit, Holds, NoHolds, StopOutcome, Supervisor};
use crate::latch::SuspendReason;
use crate::marker::{MarkerState, MarkerStore, MemoryMarker};
use crate::stop_path::StopPolicy;
use crate::timing::STOP_RELEASE_BUDGET_MS;

#[derive(Clone, Default)]
struct Exits(Arc<Mutex<Vec<i32>>>);

impl Exit for Exits {
    fn exit(&self, code: i32) {
        self.0.lock().expect("exit log").push(code);
    }
}

impl Exits {
    fn codes(&self) -> Vec<i32> {
        self.0.lock().expect("exit log").clone()
    }
}

/// A hold that never comes up: it keeps the sender and never answers.
#[derive(Default)]
struct Wedged(Option<mpsc::Sender<()>>);

impl Holds for Wedged {
    fn release(&mut self, done: mpsc::Sender<()>) {
        self.0 = Some(done);
    }
}

struct FailingMarker;

impl MarkerStore for FailingMarker {
    fn read(&self) -> MarkerState {
        MarkerState::Absent
    }
    fn commit(&mut self) -> io::Result<()> {
        Err(io::Error::other("disk full"))
    }
    fn path(&self) -> Option<&Path> {
        None
    }
}

fn local(marker: Box<dyn MarkerStore>, exits: &Exits) -> Supervisor {
    Supervisor::new(
        marker,
        StopPolicy {
            allow_host_relay_only: false,
        },
    )
    .with_exit(Box::new(exits.clone()))
}

#[test]
fn stop_commit_releases_holds_within_1s_or_exits() {
    let exits = Exits::default();
    let mut supervisor = local(Box::new(MemoryMarker::default()), &exits);
    assert_eq!(
        supervisor.stop(SuspendReason::Api, &mut NoHolds),
        StopOutcome::Committed { stop_epoch: 1 }
    );
    assert_eq!(supervisor.latch(), Some(SuspendReason::Api));
    assert_eq!(
        supervisor.marker().read(),
        MarkerState::Present,
        "the marker is committed"
    );
    assert!(exits.codes().is_empty());

    let mut wedged = local(Box::new(MemoryMarker::default()), &exits);
    let mut hold = Wedged::default();
    let started = Instant::now();
    assert_eq!(
        wedged.stop(SuspendReason::Hotkey, &mut hold),
        StopOutcome::Exited
    );
    let waited = started.elapsed();
    assert!(
        waited >= Duration::from_millis(STOP_RELEASE_BUDGET_MS),
        "waited {waited:?}"
    );
    assert!(
        waited < Duration::from_millis(STOP_RELEASE_BUDGET_MS * 3),
        "waited {waited:?}"
    );
    assert_eq!(
        exits.codes(),
        vec![1],
        "a hold still down after 1 s exits 1"
    );
    assert_eq!(
        wedged.latch(),
        Some(SuspendReason::Hotkey),
        "exec is refused from the first instant"
    );
    assert_eq!(
        wedged.marker().read(),
        MarkerState::Absent,
        "nothing is committed after a failed release"
    );
    drop(hold);

    let unpersisted = Exits::default();
    let mut failing = local(Box::new(FailingMarker), &unpersisted);
    assert_eq!(
        failing.stop(SuspendReason::Api, &mut NoHolds),
        StopOutcome::Exited
    );
    assert_eq!(
        unpersisted.codes(),
        vec![1],
        "a marker that cannot persist exits 1"
    );
}

#[test]
fn a_marker_at_start_latches_and_the_first_reason_stays() {
    let exits = Exits::default();
    let mut supervisor = local(Box::new(MemoryMarker::present()), &exits);
    assert_eq!(supervisor.latch(), Some(SuspendReason::StopMarker));
    supervisor.stop(SuspendReason::Api, &mut NoHolds);
    assert_eq!(supervisor.latch(), Some(SuspendReason::StopMarker));
    assert_eq!(supervisor.status(0).reason.as_deref(), Some("stop_marker"));
}
