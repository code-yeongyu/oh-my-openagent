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

use crate::engine::{Engine, SessionCall};
use crate::route::Route;
use crate::rpc::{failure_line, reply_line, Failure};
mod dispatch;
use dispatch::dispatch;

/// Reply lines buffered ahead of a slow reader of the output.
const OUTBOUND_CAPACITY: usize = 256;

struct Queued {
    id: RequestId,
    method: Method,
    call: SessionCall,
    cancel: oneshot::Receiver<()>,
}

/// Cancel handles of the requests of this connection that await a reply,
/// each marked whether it holds native input.
#[derive(Clone, Default)]
struct InFlight(Arc<Mutex<HashMap<RequestId, InFlightEntry>>>);

/// A request's cancel handle and whether it holds native input.
type InFlightEntry = (oneshot::Sender<()>, bool);

impl InFlight {
    /// `None` when `id` is already in flight.
    fn register(&self, id: &RequestId, holds_input: bool) -> Option<oneshot::Receiver<()>> {
        let mut requests = self.0.lock();
        if requests.contains_key(id) {
            return None;
        }
        let (cancel, cancelled) = oneshot::channel();
        requests.insert(id.clone(), (cancel, holds_input));
        Some(cancelled)
    }

    fn cancel(&self, id: &RequestId) {
        if let Some((cancel, _)) = self.0.lock().remove(id) {
            // A request that is answering right now no longer listens.
            cancel.send(()).unwrap_or(());
        }
    }

    fn finish(&self, id: &RequestId) {
        self.0.lock().remove(id);
    }

    /// Interrupts every in-flight hold so its input is released before the
    /// connection drains or the session closes. Other requests keep running
    /// and are answered as before.
    fn cancel_holds(&self) {
        let mut requests = self.0.lock();
        let holds: Vec<RequestId> = requests
            .iter()
            .filter(|(_, (_, holds_input))| *holds_input)
            .map(|(id, _)| id.clone())
            .collect();
        for id in holds {
            if let Some((cancel, _)) = requests.remove(&id) {
                cancel.send(()).unwrap_or(());
            }
        }
    }

    fn cancel_all(&self) {
        for cancel in self.0.lock().drain().map(|(_, (cancel, _))| cancel) {
            cancel.send(()).unwrap_or(());
        }
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
    serve_inner(engine, reader, writer, false).await
}

#[cfg(any(test, target_os = "macos"))]
pub async fn serve_session_connection<R, W>(engine: Arc<Engine>, reader: R, writer: W) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    serve_inner(engine, reader, writer, true).await
}

async fn serve_inner<R, W>(engine: Arc<Engine>, reader: R, writer: W, disconnect_cancels: bool) -> io::Result<()>
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
    // A session connection's disconnect cancels everything; otherwise only
    // holds are interrupted so their input is released before draining.
    if disconnect_cancels { in_flight.cancel_all(); } else { in_flight.cancel_holds(); }
    drop((queue, out));
    let dispatched = dispatcher.await.map_err(io::Error::other);
    let written = writer.await.map_err(io::Error::other).and_then(|written| written);
    let result = read.and(dispatched).and(written);
    match result {
        Err(error) if disconnect_cancels && matches!(error.kind(), io::ErrorKind::BrokenPipe | io::ErrorKind::ConnectionReset) => Ok(()),
        other => other,
    }
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
            if matches!(&call, SessionCall::Close) {
                in_flight.cancel_holds();
            }
            let holds_input = matches!(method, Method::HoldKeys | Method::HoldMouse);
            let Some(cancel) = in_flight.register(&id, holds_input) else {
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

pub(crate) fn parse_request(text: &[u8]) -> Result<RpcRequest, ParseFailure> {
    let value: Value = serde_json::from_slice(text)
        .map_err(|error| (None, Failure::Parse(format!("parse error: {error}"))))?;
    // An unreadable id is answered with `null`, as JSON-RPC 2.0 requires.
    let id = value
        .get("id")
        .and_then(|id| serde_json::from_value(id.clone()).ok());
    serde_json::from_value(value)
        .map_err(|error| (id, Failure::InvalidRequest(format!("invalid request: {error}"))))
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
