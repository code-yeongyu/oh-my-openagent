//! How a waiter settles a request that may be cancelled while it runs.

use std::future::Future;

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
    use std::future::{pending, ready};

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
}
