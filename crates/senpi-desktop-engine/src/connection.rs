//! One JSON-RPC 2.0 NDJSON connection (stdio or a `--serve` client).
//!
//! The reader answers engine-level methods at once and enqueues session
//! requests in arrival order; a dispatcher admits them under the read (4) and
//! exec (1) permits; each admitted request waits for its reply, deadline, or
//! `$/cancel` on its own task, so replies may leave out of order. A writer
//! task owns the output behind a bounded channel. Queued notifications are
//! written right after each reply (see [`crate::outbox`]).

use std::collections::HashMap;
use std::io;
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::error::DesktopError;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol::{MethodRejection, RequestId, RpcRequest};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc::error::SendError;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinSet;

use crate::engine::{Engine, SessionCall};
use crate::route::Route;
use crate::rpc::{failure_line, reply_line, Failure};

/// Reply lines buffered ahead of a slow reader of the output.
const OUTBOUND_CAPACITY: usize = 256;

struct Queued {
    id: RequestId,
    method: Method,
    call: SessionCall,
    cancel: oneshot::Receiver<()>,
}

/// Cancel handles of the requests of this connection that await a reply.
#[derive(Clone, Default)]
struct InFlight(Arc<Mutex<HashMap<RequestId, oneshot::Sender<()>>>>);

impl InFlight {
    /// `None` when `id` is already in flight.
    fn register(&self, id: &RequestId) -> Option<oneshot::Receiver<()>> {
        let mut requests = self.0.lock();
        if requests.contains_key(id) {
            return None;
        }
        let (cancel, cancelled) = oneshot::channel();
        requests.insert(id.clone(), cancel);
        Some(cancelled)
    }

    fn cancel(&self, id: &RequestId) {
        if let Some(cancel) = self.0.lock().remove(id) {
            // A request that is answering right now no longer listens.
            cancel.send(()).unwrap_or(());
        }
    }

    fn finish(&self, id: &RequestId) {
        self.0.lock().remove(id);
    }
}

/// Serves requests from `reader` until it ends, then answers every request
/// still in flight before returning.
///
/// # Errors
/// Reading the input or writing the output failed.
pub async fn serve_connection<R, W>(engine: Arc<Engine>, reader: R, writer: W) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (out, lines) = mpsc::channel(OUTBOUND_CAPACITY);
    let writer = tokio::spawn(write_lines(writer, lines));
    let (queue, queued) = mpsc::unbounded_channel();
    let in_flight = InFlight::default();
    let dispatcher = tokio::spawn(dispatch(
        Arc::clone(&engine),
        queued,
        out.clone(),
        in_flight.clone(),
    ));
    let read = read_requests(&engine, reader, &out, &queue, &in_flight).await;
    drop((queue, out));
    let dispatched = dispatcher.await.map_err(io::Error::other);
    let written = writer.await.map_err(io::Error::other).and_then(|written| written);
    read.and(dispatched).and(written)
}

async fn read_requests<R: AsyncRead + Unpin>(
    engine: &Engine,
    reader: R,
    out: &mpsc::Sender<String>,
    queue: &mpsc::UnboundedSender<Queued>,
    in_flight: &InFlight,
) -> io::Result<()> {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line).await? == 0 {
            return Ok(());
        }
        let text = line.trim_ascii();
        if text.is_empty() {
            continue;
        }
        let Some(reply) = handle_line(engine, text, queue, in_flight) else {
            continue;
        };
        if deliver(engine, out, reply).await.is_err() {
            // The writer stopped: nobody can read replies any more.
            return Ok(());
        }
    }
}

/// The immediate reply to one input line, if any.
fn handle_line(
    engine: &Engine,
    text: &[u8],
    queue: &mpsc::UnboundedSender<Queued>,
    in_flight: &InFlight,
) -> Option<String> {
    let request = match parse_request(text) {
        Ok(request) => request,
        Err((id, failure)) => return Some(failure_line(id, failure)),
    };
    let Some(method) = Method::from_name(&request.method) else {
        return request
            .id
            .map(|id| failure_line(Some(id), Failure::Rejected(MethodRejection::Unknown)));
    };
    // A notification carries no id to answer; only `$/cancel` acts on one.
    if request.id.is_none() && method != Method::Cancel {
        return None;
    }
    match (engine.route(method, request.params), request.id) {
        (Route::Cancel(target), id) => {
            in_flight.cancel(&target);
            id.map(|id| reply_line(id, Ok(Value::Null)))
        }
        (Route::Immediate(_) | Route::Session(_), None) => None,
        (Route::Immediate(outcome), Some(id)) => Some(reply_line(id, outcome)),
        (Route::Session(call), Some(id)) => {
            let Some(cancel) = in_flight.register(&id) else {
                let duplicate = Failure::InvalidRequest("a request with this id is already in flight".into());
                return Some(failure_line(Some(id), duplicate));
            };
            let queued = Queued {
                id,
                method,
                call,
                cancel,
            };
            queue.send(queued).err().map(|unsent| {
                let stopped = DesktopError::internal("the request dispatcher stopped");
                failure_line(Some(unsent.0.id), Failure::Engine(stopped))
            })
        }
    }
}

type ParseFailure = (Option<RequestId>, Failure);

fn parse_request(text: &[u8]) -> Result<RpcRequest, ParseFailure> {
    let value: Value = serde_json::from_slice(text)
        .map_err(|error| (None, Failure::Parse(format!("parse error: {error}"))))?;
    // An unreadable id is answered with `null`, as JSON-RPC 2.0 requires.
    let id = value
        .get("id")
        .and_then(|id| serde_json::from_value(id.clone()).ok());
    serde_json::from_value(value)
        .map_err(|error| (id, Failure::InvalidRequest(format!("invalid request: {error}"))))
}

async fn dispatch(
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
                // The writer only stops once the client is gone.
                deliver(&engine, &out, reply_line(id, Err(failure)))
                    .await
                    .unwrap_or(());
                continue;
            }
        };
        // Enqueued here, in arrival order; only the wait runs concurrently.
        let started = engine.begin(call);
        let (engine, out, in_flight) = (Arc::clone(&engine), out.clone(), in_flight.clone());
        waiters.spawn(async move {
            let outcome = tokio::select! {
                outcome = started.wait() => outcome,
                _ = cancel => Err(Failure::cancelled()),
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

/// Writes `reply`, then every notification queued so far.
///
/// # Errors
/// The writer stopped: nobody reads the output any more.
async fn deliver(
    engine: &Engine,
    out: &mpsc::Sender<String>,
    reply: String,
) -> Result<(), SendError<String>> {
    out.send(reply).await?;
    for line in engine.outbox().drain() {
        out.send(line).await?;
    }
    Ok(())
}

fn report(joined: Result<(), tokio::task::JoinError>) {
    if let Err(error) = joined {
        eprintln!("senpi-desktop-engine: a request task failed before replying: {error}");
    }
}

async fn write_lines<W: AsyncWrite + Unpin>(
    mut writer: W,
    mut lines: mpsc::Receiver<String>,
) -> io::Result<()> {
    while let Some(mut line) = lines.recv().await {
        line.push('\n');
        writer.write_all(line.as_bytes()).await?;
        writer.flush().await?;
    }
    Ok(())
}
