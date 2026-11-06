//! Session admission and cancellation, shared by NDJSON and XPC connections.
use super::{deliver, InFlight, Queued};
use crate::{
    engine::Engine,
    rpc::{reply_line, Failure},
    settle::{settle, settle_hold},
};
use senpi_desktop_core::error::DesktopError;
use senpi_desktop_core::report::Disposition;
use std::sync::Arc;
use tokio::{sync::mpsc, task::JoinSet};

pub(super) async fn dispatch(
    engine: Arc<Engine>,
    mut queued: mpsc::UnboundedReceiver<Queued>,
    out: mpsc::Sender<String>,
    in_flight: InFlight,
) {
    let mut waiters = JoinSet::new();
    while let Some(Queued {
        id,
        method,
        call,
        mut cancel,
    }) = queued.recv().await
    {
        let permits = engine.permits(method.spec().effect);
        let admitted = tokio::select! {
            biased;
            _ = &mut cancel => Err(Failure::cancelled()),
            permit = permits.acquire_owned() => permit
                .map_err(|_| Failure::Engine(DesktopError::internal("request permits were closed"))),
        };
        let admitted =
            admitted.map_err(|failure| not_dispatched(failure, engine.reports_action(method)));
        let permit = match admitted {
            Ok(permit) => permit,
            Err(failure) => {
                in_flight.finish(&id);
                deliver(&engine, &out, reply_line(id, Err(failure)))
                    .await
                    .unwrap_or(());
                continue;
            }
        };
        let started = engine.begin(call);
        let reports_action = started.reports_action(method);
        let (engine, out, in_flight) = (Arc::clone(&engine), out.clone(), in_flight.clone());
        waiters.spawn(async move {
            let outcome = match started.hold_signal() {
                Some(signal) => {
                    let budget = engine.hold_release_budget();
                    settle_hold(started.wait(), cancel, || signal.cancel(), budget).await
                }
                None => settle(started.wait(), cancel, || Err(Failure::cancelled())).await,
            };
            // This request's own mode: an open applied after it started does not count.
            let outcome = if reports_action() {
                outcome.map_err(Failure::with_unreported_disposition)
            } else {
                outcome
            };
            drop(permit);
            in_flight.finish(&id);
            deliver(&engine, &out, reply_line(id, outcome))
                .await
                .unwrap_or(());
        });
        while let Some(joined) = waiters.try_join_next() {
            report(joined);
        }
    }
    while let Some(joined) = waiters.join_next().await {
        report(joined);
    }
}

/// A request refused before it reached the session (a cancel, or request
/// permits that were closed): nothing ran.
fn not_dispatched(failure: Failure, reports: bool) -> Failure {
    match failure {
        Failure::Engine(error) if reports => {
            Failure::Engine(error.with_fallback_disposition(Disposition::NOT_DELIVERED_SAFE))
        }
        failure => failure,
    }
}

fn report(joined: Result<(), tokio::task::JoinError>) {
    if let Err(error) = joined {
        eprintln!("senpi-desktop-engine: a request task failed before replying: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disposition(failure: Failure) -> Option<Disposition> {
        let Failure::Engine(error) = failure else {
            panic!("admission refuses with an engine failure");
        };
        error.report.and_then(|report| report.disposition)
    }

    #[test]
    fn closed_request_permits_refuse_an_object_mode_mutation_as_not_delivered_and_safe() {
        // Given the refusal of a request whose permits were closed before it reached the session.
        let closed = || Failure::Engine(DesktopError::internal("request permits were closed"));
        // When / Then: an object-mode mutation says nothing was sent ...
        assert_eq!(
            disposition(not_dispatched(closed(), true)),
            Some(Disposition::NOT_DELIVERED_SAFE)
        );
        // ... and a request that reports no action keeps the legacy reply.
        assert_eq!(disposition(not_dispatched(closed(), false)), None);
    }
}
