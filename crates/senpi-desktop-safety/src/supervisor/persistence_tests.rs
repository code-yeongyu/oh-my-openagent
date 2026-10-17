use super::{StopSource, Supervisor};
use crate::FakeClock;
use parking_lot::Mutex;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Weak,
};

#[test]
fn every_stop_source_refuses_input_before_committing_then_publishes() {
    for source in [StopSource::Api, StopSource::HostRelay, StopSource::Hotkey] {
        // given
        let reference = Arc::new(Mutex::new(Weak::<Supervisor>::new()));
        let commits = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&reference);
        let recorded = Arc::clone(&commits);
        let supervisor = Arc::new(Supervisor::with_stop_commit(
            Arc::new(FakeClock::new(0)),
            false,
            move || {
                let supervisor = observed.lock().upgrade().unwrap();
                assert!(supervisor.is_suspended());
                assert!(!supervisor.published_status().suspended);
                assert_eq!(supervisor.stop_epoch(), 0);
                recorded.fetch_add(1, Ordering::SeqCst);
            },
        ));
        *reference.lock() = Arc::downgrade(&supervisor);
        // when
        supervisor.trigger_stop(source);
        // then
        assert_eq!(commits.load(Ordering::SeqCst), 1);
        assert!(supervisor.status().suspended);
        assert_eq!(supervisor.stop_epoch(), 1);
    }
}

#[test]
fn restored_stop_is_visible_without_rewriting_the_marker() {
    // given
    let commits = Arc::new(AtomicUsize::new(0));
    let recorded = Arc::clone(&commits);
    // when
    let supervisor = Supervisor::with_stop_commit(Arc::new(FakeClock::new(0)), true, move || {
        recorded.fetch_add(1, Ordering::SeqCst);
    });
    // then
    assert!(supervisor.status().suspended);
    assert!(supervisor.hold_signal().check(&supervisor).is_err());
    assert_eq!(commits.load(Ordering::SeqCst), 0);
}

#[test]
fn a_commit_that_does_not_return_cannot_publish_or_acknowledge_a_stop() {
    // given
    let supervisor = Supervisor::with_stop_commit(Arc::new(FakeClock::new(0)), false, || {
        panic!("injected durable commit failure");
    });
    // when
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        supervisor.trigger_stop(StopSource::Api);
    }));
    // then
    assert!(result.is_err());
    assert!(supervisor.is_suspended());
    assert!(!supervisor.published_status().suspended);
    assert_eq!(supervisor.stop_epoch(), 0);
}
