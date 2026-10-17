use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use senpi_desktop_core::error::ErrorCode;

use crate::{FakeClock, StopSource, Supervisor};

fn supervisor() -> Arc<Supervisor> {
    Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))))
}

#[test]
fn cancellation_before_wait_cannot_be_lost() {
    // Given a registered request whose waiter has already disappeared.
    let supervisor = supervisor();
    let signal = supervisor.hold_signal();
    signal.cancel();
    // When the hold reaches its bounded wait.
    let result = signal.wait(&supervisor, Duration::from_secs(100));
    // Then it returns cancellation instead of sleeping for the duration.
    assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
}

#[test]
fn stop_wins_over_cancel_even_after_resume() {
    // Given a registered hold interrupted by both sources.
    let supervisor = supervisor();
    let signal = supervisor.hold_signal();
    signal.cancel();
    supervisor.trigger_stop(StopSource::Api);
    supervisor.reset_for_test();
    // When a quick user resume races the hold's next state check.
    let result = signal.wait(&supervisor, Duration::from_secs(100));
    // Then the old hold cannot continue under the new stop epoch.
    assert_eq!(result.unwrap_err().code, ErrorCode::Suspended);
}

#[test]
fn cancellation_and_stop_wake_a_waiting_hold() {
    for stop in [false, true] {
        // Given an interruption registered before starting the worker.
        let supervisor = supervisor();
        let signal = supervisor.hold_signal();
        let starting = supervisor.subscribe_hold_wait_for_test();
        let (done, completed) = mpsc::channel();
        let worker_signal = Arc::clone(&signal);
        let worker_supervisor = Arc::clone(&supervisor);
        let worker = thread::spawn(move || {
            done.send(worker_signal.wait(&worker_supervisor, Duration::from_secs(100)))
                .unwrap();
        });
        starting.recv_timeout(Duration::from_secs(2)).unwrap();
        // When either interruption lands only after the atomic park handshake.
        if stop {
            supervisor.trigger_stop(StopSource::Hotkey);
        } else {
            signal.cancel();
        }
        // Then the 100-second wait completes at the interruption, without
        // a timer tick or a polling loop driving cancellation.
        let error = completed
            .recv_timeout(Duration::from_secs(2))
            .expect("interruption did not wake the hold")
            .unwrap_err();
        worker.join().unwrap();
        assert_eq!(
            error.code,
            if stop { ErrorCode::Suspended } else { ErrorCode::Cancelled }
        );
    }
}

#[test]
fn completed_requests_do_not_accumulate_strong_stop_subscriptions() {
    // Given requests that have finished and dropped their signals.
    let supervisor = supervisor();
    let signal = supervisor.hold_signal();
    let weak = Arc::downgrade(&signal);
    drop(signal);
    // When another hold registers and a safety stop fires.
    let next = supervisor.hold_signal();
    supervisor.trigger_stop(StopSource::Api);
    // Then the supervisor did not retain the finished request.
    assert!(weak.upgrade().is_none());
    assert_eq!(next.check(&supervisor).unwrap_err().code, ErrorCode::Suspended);
}

#[test]
fn r2_m3_physical_scope_finishes_before_commit_and_reply_waits_for_publication() {
    use std::sync::atomic::{AtomicBool, Ordering};
    // given
    let released = Arc::new(AtomicBool::new(false));
    let observed = Arc::new(AtomicBool::new(false));
    let at_commit = Arc::clone(&released);
    let observation = Arc::clone(&observed);
    let supervisor = Arc::new(Supervisor::with_stop_commit(Arc::new(FakeClock::new(0)), false, move || {
        observation.store(at_commit.load(Ordering::SeqCst), Ordering::SeqCst);
    }));
    let signal = supervisor.hold_signal();
    let worker_supervisor = Arc::clone(&supervisor);
    let (started, ready) = mpsc::channel();
    let worker = thread::spawn(move || signal.with_input(&worker_supervisor, || {
        started.send(()).unwrap();
        let result = signal.wait(&worker_supervisor, Duration::from_secs(100));
        // Models the backend's release-on-return contract.
        released.store(true, Ordering::SeqCst);
        result
    }));
    ready.recv_timeout(Duration::from_secs(5)).unwrap();
    // when
    supervisor.trigger_stop(StopSource::Hotkey);
    // then
    assert_eq!(worker.join().unwrap().unwrap_err().code, ErrorCode::Suspended);
    assert!(observed.load(Ordering::SeqCst), "durable write started before physical release");
}
