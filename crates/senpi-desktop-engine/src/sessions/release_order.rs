use super::*;
use parking_lot::Mutex;
use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_safety::{MonotonicClock, StopSource, Supervisor};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::Duration;

async fn release_before_commit(fails: bool) {
    // given: the real fake backend has physically pressed a key.
    let events = Arc::new(Mutex::new(None::<mpsc::Receiver<SinkOp>>));
    let released_at_commit = Arc::new(AtomicBool::new(false));
    let observed_events = Arc::clone(&events);
    let observed_release = Arc::clone(&released_at_commit);
    let supervisor = Arc::new(Supervisor::with_stop_commit(
        Arc::new(MonotonicClock::new()),
        false,
        move || {
            let released = observed_events
                .lock()
                .as_ref()
                .unwrap()
                .try_iter()
                .any(|op| matches!(op, SinkOp::HeldKey { down: false, .. }));
            observed_release.store(released, Ordering::SeqCst);
            if fails {
                panic!("injected durable write failure");
            }
        },
    ));
    let owner = Sessions::with_supervisor(Arc::clone(&supervisor));
    let (client, held_events) = super::holds::held_client(&owner, Duration::from_secs(120)).await;
    *events.lock() = Some(held_events);
    // when: the callback is the first operation of a potentially slow write.
    let stopped = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        supervisor.trigger_stop(StopSource::Hotkey);
    }));
    // Cleanup also releases an old-code hold after the injected failure.
    client.close().await;
    // then: failure cannot exit with input still held; no timing guess is used.
    assert_eq!(stopped.is_err(), fails);
    assert!(
        released_at_commit.load(Ordering::SeqCst),
        "held input was not released before durable commit"
    );
    assert!(supervisor.is_suspended());
    assert_eq!(supervisor.published_status().suspended, !fails);
    assert_eq!(supervisor.stop_epoch(), u64::from(!fails));
}

#[tokio::test]
async fn r2_m3_hotkey_releases_before_slow_write_begins() {
    release_before_commit(false).await;
}

#[tokio::test]
async fn r2_m3_hotkey_releases_before_a_failed_write_exits() {
    release_before_commit(true).await;
}
