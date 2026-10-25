//! Session admission and cancellation, shared by NDJSON and XPC connections.
use super::{deliver, InFlight, Queued};
use crate::{
    engine::Engine,
    rpc::{reply_line, Failure},
    settle::{settle, settle_hold},
};
use senpi_desktop_core::error::DesktopError;
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
        let (engine, out, in_flight) = (Arc::clone(&engine), out.clone(), in_flight.clone());
        waiters.spawn(async move {
            let outcome = match started.hold_signal() {
                Some(signal) => {
                    let budget = engine.hold_release_budget();
                    settle_hold(started.wait(), cancel, || signal.cancel(), budget).await
                }
                None => settle(started.wait(), cancel, || Err(Failure::cancelled())).await,
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

fn report(joined: Result<(), tokio::task::JoinError>) {
    if let Err(error) = joined {
        eprintln!("senpi-desktop-engine: a request task failed before replying: {error}");
    }
}
