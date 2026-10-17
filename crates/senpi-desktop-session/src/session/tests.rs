use std::future::Future;
use std::sync::Arc;
use std::task::Poll;
use std::time::Duration;

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_safety::{FakeClock, Supervisor};

use super::{Pending, PendingKind, Response};

#[tokio::test]
async fn submitted_long_holds_keep_the_duration_aware_deadline() {
    // Given a real session with a three-second operation margin.
    let session = super::Session::start(
        crate::selection::BackendSelection::FakeScenario(Box::default()),
        crate::timeouts::SessionTimeouts {
            operation: Duration::from_secs(3),
            close: Duration::from_secs(2),
        },
    ).unwrap();
    // When a 100-second hold is submitted (no backend input is admitted).
    let pending = session.submit(crate::request::Op::HoldKeys(
        senpi_desktop_core::protocol_params::HoldKeysParams {
            target: "101".into(), keys: vec!["shift".into()], duration: 100.0, opts: None,
        },
    ));
    // Then submit uses the hold budget, not the ordinary operation deadline.
    assert_eq!(pending.budget, Duration::from_secs(103));
    drop(pending);
    session.close().wait().await.unwrap();
}

#[tokio::test]
async fn hold_deadline_waits_for_worker_release_before_timeout_reply() {
    // Given an expired hold with a worker reply still outstanding.
    let supervisor = Supervisor::new(Arc::new(FakeClock::new(0)));
    let signal = supervisor.hold_signal();
    let (reply, replied) = flume::bounded(1);
    let mut pending = Pending::new(PendingKind::Reply(replied), Duration::ZERO);
    pending.deadline = tokio::time::Instant::now() - Duration::from_secs(1);
    pending.cancellation = Some(crate::cancel_on_drop::CancelOnDrop(Arc::clone(&signal)));
    pending.release_budget = Some(Duration::from_secs(2));
    let result = pending.wait();
    tokio::pin!(result);
    // When the deadline cancels the hold without dropping its receiver.
    std::future::poll_fn(|cx| {
        assert!(result.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    }).await;
    assert_eq!(signal.check(&supervisor).unwrap_err().code, ErrorCode::Cancelled);
    // Then it cannot report Timeout until the worker acknowledges cleanup.
    reply.send(Ok(Response::Unit)).unwrap();
    assert_eq!(result.await.unwrap_err().code, ErrorCode::Timeout);
}
