//! How a waiter settles a request that may be cancelled while it runs.

use std::future::Future;
use senpi_desktop_core::error::DesktopError;
use senpi_desktop_core::holds::reports_release_failure;
use crate::rpc::Failure;

/// Holds keep their receiver alive until cleanup replies, bounded by the
/// configured close budget (`SENPI_DESKTOP_CLOSE_TIMEOUT_MS`, the same budget
/// the session gives a hold's release). Cancellation must not publish before release.
pub(crate) async fn settle_hold<T>(
    outcome: impl Future<Output = Result<T, Failure>>,
    cancel: impl Future,
    interrupt: impl FnOnce(),
    release_budget: std::time::Duration,
) -> Result<T, Failure> {
    tokio::pin!(outcome);
    tokio::select! {
        biased;
        result = &mut outcome => result,
        _ = cancel => {
            interrupt();
            match tokio::time::timeout(release_budget, &mut outcome).await {
                Ok(Err(Failure::Engine(error))) if reports_release_failure(&error) => {
                    Err(Failure::Engine(error))
                }
                Ok(_) => Err(Failure::cancelled()),
                Err(_) => Err(Failure::Engine(DesktopError::timeout("held input release did not complete"))),
            }
        },
    }
}

/// The request's outcome, or `cancelled()` when the cancel lands first.
///
/// When both are ready at once the outcome wins: the session thread has
/// already committed the request (an observe's frame and refs, an input),
/// so answering `Cancelled` would hide state the engine kept. A cancel can still win when it lands
/// within the same poll as the worker's reply; that window is one poll wide.
pub(crate) async fn settle<T>(
    outcome: impl Future<Output = T>,
    cancel: impl Future,
    cancelled: impl FnOnce() -> T,
) -> T {
    tokio::select! {
        biased;
        outcome = outcome => outcome,
        _ = cancel => cancelled(),
    }
}

#[cfg(test)]
mod tests {
    use std::future::{pending, ready, Future};

    use super::settle;

    fn block_on<T>(work: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("a current-thread runtime starts")
            .block_on(work)
    }

    #[test]
    fn a_finished_outcome_beats_a_cancel_that_is_ready_at_the_same_time() {
        for _ in 0..64 {
            let settled = block_on(settle(ready("committed"), ready(()), || "cancelled"));
            assert_eq!(settled, "committed");
        }
    }

    #[test]
    fn a_cancel_settles_a_request_that_is_still_running() {
        let settled = block_on(settle(pending::<&str>(), ready(()), || "cancelled"));
        assert_eq!(settled, "cancelled");
    }

    #[tokio::test]
    async fn hold_cancel_waits_for_the_worker_release_reply() {
        use std::task::Poll;
        // Given a cancelled hold whose worker has not replied yet.
        let (released, reply) = tokio::sync::oneshot::channel::<()>();
        let result = super::settle_hold(
            async { reply.await.unwrap(); Ok::<_, crate::rpc::Failure>(()) },
            ready(()),
            || {},
            senpi_desktop_session::CLOSE_TIMEOUT,
        );
        tokio::pin!(result);
        // When cancellation is polled before the release acknowledgement.
        std::future::poll_fn(|cx| {
            assert!(result.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        }).await;
        // Then settlement requires the worker's actual reply.
        released.send(()).unwrap();
        assert_eq!(result.await, Err(crate::rpc::Failure::cancelled()));
    }

    #[tokio::test]
    async fn a_release_failure_after_cancel_is_reported_not_hidden() {
        use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
        use senpi_desktop_core::holds::merge_release;
        // Given a cancelled hold whose worker also failed to release the input.
        let mut outcome: CoreResult<()> =
            Err(DesktopError::new(ErrorCode::Cancelled, "the hold request was cancelled"));
        merge_release(&mut outcome, Err(DesktopError::input_failed("key up failed")));
        let reported = outcome.unwrap_err();
        // When the cancel lands first.
        let result = super::settle_hold(
            async move { Err::<(), _>(crate::rpc::Failure::Engine(reported)) },
            ready(()),
            || {},
            senpi_desktop_session::CLOSE_TIMEOUT,
        )
        .await;
        // Then the release failure reaches the caller instead of a plain Cancelled.
        let Err(crate::rpc::Failure::Engine(error)) = result else {
            panic!("expected an engine failure, got {result:?}");
        };
        assert!(error.message.contains("key up failed"), "{}", error.message);
    }
}
