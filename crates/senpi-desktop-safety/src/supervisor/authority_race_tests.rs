use super::authority_test_support::{backend, input, proof, supervisor};
use super::StopSource;
use crate::{AuthorityResetError, GateError};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

#[test]
fn newer_callback_refuses_input_before_worker_commit() {
    // Given: a real supervisor and an activation paused at its last transition.
    let supervisor = supervisor(|_| {});
    let pending = proof(&supervisor);
    let (entered, entering) = mpsc::channel();
    let (resume, resumed) = mpsc::channel();
    *supervisor.activation_hook.lock() = Some(Box::new(move || {
        entered.send(()).unwrap();
        resumed.recv_timeout(Duration::from_secs(5)).unwrap();
    }));
    let activating = Arc::clone(&supervisor);
    let activation = thread::spawn(move || activating.activate_authority(pending));
    entering.recv_timeout(Duration::from_secs(5)).unwrap();
    let (drain, draining) = mpsc::channel();
    let stopping = Arc::clone(&supervisor);
    let worker = thread::spawn(move || {
        draining.recv_timeout(Duration::from_secs(5)).unwrap();
        stopping.complete_stop(StopSource::Hotkey);
    });
    // When: callback returns, then activation finishes with durable work blocked.
    supervisor.suspend_input();
    resume.send(()).unwrap();
    let activated = activation.join().unwrap();
    let refused_before_commit = supervisor.is_suspended();
    let hold_refused_before_commit = supervisor.hold_signal().check(&supervisor).is_err();
    let status_before_commit = supervisor.status();
    let mut backend = backend();
    let input_before_commit = input(&supervisor, &mut backend);
    drain.send(()).unwrap();
    worker.join().unwrap();
    // Then: immediate input must already have been refused, not just after drain.
    assert!(
        refused_before_commit,
        "activation reopened input after callback returned"
    );
    assert!(hold_refused_before_commit);
    assert_eq!(activated, Err(AuthorityResetError::StaleStop));
    assert!(status_before_commit.suspended);
    assert_eq!(input_before_commit, Err(GateError::Suspended));
    assert!(backend.sink().ops().is_empty());
}

#[test]
fn activation_before_callback_is_stopped_before_worker_runs() {
    // Given: a successful activation and a worker held before commit.
    let supervisor = supervisor(|_| {});
    supervisor.activate_authority(proof(&supervisor)).unwrap();
    let mut backend = backend();
    input(&supervisor, &mut backend).unwrap();
    let before = backend.sink().ops();
    let (release, released) = mpsc::channel();
    let stopping = Arc::clone(&supervisor);
    let worker = thread::spawn(move || {
        released.recv_timeout(Duration::from_secs(5)).unwrap();
        stopping.complete_stop(StopSource::Hotkey);
    });
    // When: the actual callback transition returns before any durable work.
    supervisor.suspend_input();
    let suspended = supervisor.is_suspended();
    let status = supervisor.status();
    let refused = input(&supervisor, &mut backend);
    let pending = supervisor.stop_pending();
    release.send(()).unwrap();
    worker.join().unwrap();
    // Then: admission and status immediately refuse, with no backend event.
    assert!(suspended && status.suspended && pending);
    assert_eq!(refused, Err(GateError::Suspended));
    assert_eq!(backend.sink().ops(), before);
}

#[test]
fn a_callback_during_commit_needs_further_coverage_without_double_counting() {
    // Given: the first durable commit paused after snapshotting generation 1.
    let (entered, entering) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let released = std::sync::Mutex::new(released);
    let commits = Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = Arc::clone(&commits);
    let supervisor = supervisor(move |generation| {
        recorded.lock().unwrap().push(generation);
        if generation == 1 {
            entered.send(()).unwrap();
            released
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
    });
    supervisor.suspend_input();
    let stopping = Arc::clone(&supervisor);
    let worker = thread::spawn(move || stopping.complete_stop(StopSource::Hotkey));
    entering.recv_timeout(Duration::from_secs(5)).unwrap();
    // When: two more callbacks coalesce while the earlier commit is paused.
    supervisor.suspend_input();
    supervisor.suspend_input();
    let pending = supervisor.stop_pending();
    release.send(()).unwrap();
    worker.join().unwrap();
    let epoch = supervisor.stop_epoch();
    supervisor.activate_authority(proof(&supervisor)).unwrap();
    let activated_epoch = supervisor.stop_epoch();
    supervisor.complete_stop(StopSource::Hotkey);
    // Then: drain covers 1 then 3, and duplicate delivery cannot republish.
    assert!(pending);
    assert_eq!(*commits.lock().unwrap(), vec![1, 3]);
    assert_eq!(epoch, 2);
    assert!(!supervisor.is_suspended());
    assert!(!supervisor.published_status().suspended);
    assert!(!supervisor.stop_pending());
    assert_eq!(supervisor.stop_epoch(), activated_epoch);
}
