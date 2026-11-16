//! One JSON-RPC 2.0 NDJSON connection (stdio or a `--serve` client).
//!
//! The reader answers engine-level methods at once and enqueues session
//! requests in arrival order; a dispatcher admits them under the read (4) and
//! exec (1) permits; each admitted request waits for its reply, deadline, or
//! `$/cancel` on its own task, so replies may leave out of order. A writer
//! task owns the output behind a bounded channel. Queued notifications are
//! written right after each reply (see [`crate::outbox`]); on a `--serve`
//! daemon they go to every live connection of the shared session.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::error::{DesktopError, ErrorReport};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol::{MethodRejection, RequestId, RpcRequest};
use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc::error::{SendError, TrySendError};
use tokio::sync::{mpsc, oneshot};

use crate::engine::{Engine, SessionCall};
use crate::route::Route;
use crate::rpc::{failure_line, reply_line, Failure};
mod dispatch;
use dispatch::dispatch;

/// Reply lines buffered ahead of a slow reader of the output.
const OUTBOUND_CAPACITY: usize = 256;

/// The longest request line, newline excluded (DESIGN 9, request size); a
/// longer one is discarded unread and answered `request_too_large` under the
/// id read from its bytes as they stream past (see [`IdSniff`]).
pub(crate) const MAX_REQUEST_BYTES: usize = 1 << 20;

/// The longest id value an oversized line may carry and still be answered.
const MAX_ID_BYTES: usize = 1024;

struct Queued {
    id: RequestId,
    method: Method,
    call: SessionCall,
    cancel: oneshot::Receiver<()>,
    /// The stop generation when the request arrived; a stop read after it
    /// makes its reply a late one (see [`dispatch`]).
    generation: u64,
}

/// The live connections of one `--serve` daemon. A notification drained by
/// any of them is written to all of them (#12229 T25-18).
#[derive(Clone, Default)]
pub struct Fanout {
    next: Arc<AtomicU64>,
    live: Arc<Mutex<Vec<LiveConnection>>>,
}

/// A live connection's id and output.
type LiveConnection = (u64, mpsc::Sender<String>);

impl Fanout {
    fn join(&self, out: mpsc::Sender<String>) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.live.lock().push((id, out));
        id
    }

    fn leave(&self, id: u64) {
        self.live.lock().retain(|(live, _)| *live != id);
    }

    /// Queues `line` on every live connection but `own`. A connection whose
    /// output is full is not waited for; the line it misses is reported.
    fn others(&self, own: u64, line: &str) {
        for (id, out) in self.live.lock().iter() {
            if *id == own {
                continue;
            }
            if let Err(TrySendError::Full(_)) = out.try_send(line.to_owned()) {
                eprintln!("senpi-desktop-engine: dropped a notification for --serve connection {id}: its output is full");
            }
        }
    }
}

/// Where one connection's replies go, and the daemon's other connections.
#[derive(Clone)]
struct Outbound {
    own: mpsc::Sender<String>,
    shared: Option<(u64, Fanout)>,
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
    serve_inner(engine, reader, writer, false, None).await
}

/// A `--serve` client of the daemon's shared session: like
/// [`serve_connection`], and notifications reach every connection in `fanout`.
///
/// # Errors
/// Reading the input or writing the output failed.
#[cfg(unix)]
pub async fn serve_shared_connection<R, W>(
    engine: Arc<Engine>,
    reader: R,
    writer: W,
    fanout: &Fanout,
) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    serve_inner(engine, reader, writer, false, Some(fanout)).await
}

#[cfg(any(test, target_os = "macos"))]
pub async fn serve_session_connection<R, W>(engine: Arc<Engine>, reader: R, writer: W) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    serve_inner(engine, reader, writer, true, None).await
}

async fn serve_inner<R, W>(
    engine: Arc<Engine>,
    reader: R,
    writer: W,
    disconnect_cancels: bool,
    fanout: Option<&Fanout>,
) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (own, lines) = mpsc::channel(OUTBOUND_CAPACITY);
    let writer = tokio::spawn(write_lines(writer, lines));
    let shared = fanout.map(|fanout| (fanout.join(own.clone()), fanout.clone()));
    let out = Outbound { own, shared };
    let (queue, queued) = mpsc::unbounded_channel();
    let in_flight = InFlight::default();
    let dispatcher = tokio::spawn(dispatch(
        Arc::clone(&engine),
        queued,
        out.clone(),
        in_flight.clone(),
    ));
    let read = read_requests(&engine, reader, &out, &queue, &in_flight).await;
    // The fanout's copy of this connection's sender would keep its writer open.
    if let Some((id, fanout)) = &out.shared {
        fanout.leave(*id);
    }
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
    out: &Outbound,
    queue: &mpsc::UnboundedSender<Queued>,
    in_flight: &InFlight,
) -> io::Result<()> {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    loop {
        let reply = match read_line(&mut reader, &mut line).await? {
            Line::End => return Ok(()),
            Line::TooLarge(Sniffed::Id(id)) => Some(failure_line(Some(id), Failure::Engine(request_too_large(true)))),
            // A notification is never answered, oversized or not.
            Line::TooLarge(Sniffed::Notification) => None,
            Line::TooLarge(Sniffed::Unknown) => {
                // No caller can be told which request failed, so none may
                // keep waiting: say why, then close the connection.
                let refusal = failure_line(None, Failure::Engine(request_too_large(false)));
                deliver(engine, out, refusal).await.unwrap_or(());
                return Ok(());
            }
            Line::Read => {
                let text = line.trim_ascii();
                if text.is_empty() {
                    continue;
                }
                handle_line(engine, text, queue, in_flight)
            }
        };
        let Some(reply) = reply else {
            continue;
        };
        if deliver(engine, out, reply).await.is_err() {
            // The writer stopped: nobody can read replies any more.
            return Ok(());
        }
    }
}

enum Line {
    End,
    Read,
    /// Longer than [`MAX_REQUEST_BYTES`]: discarded, with what its bytes said
    /// about its id.
    TooLarge(Sniffed),
}

/// Reads one line into `line`, keeping at most [`MAX_REQUEST_BYTES`] of it in
/// memory; the rest of an oversized line is consumed and dropped, its id read
/// on the way.
async fn read_line<R: AsyncBufRead + Unpin>(reader: &mut R, line: &mut Vec<u8>) -> io::Result<Line> {
    line.clear();
    let mut sniff: Option<IdSniff> = None;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(match sniff {
                Some(sniff) => Line::TooLarge(sniff.finish()),
                None if line.is_empty() => Line::End,
                None => Line::Read,
            });
        }
        let newline = available.iter().position(|&byte| byte == b'\n');
        let content = &available[..newline.unwrap_or(available.len())];
        if let Some(sniff) = sniff.as_mut() {
            sniff.feed(content);
        } else if line.len() + content.len() > MAX_REQUEST_BYTES {
            let mut started = IdSniff::default();
            started.feed(line);
            started.feed(content);
            *line = Vec::new();
            sniff = Some(started);
        } else {
            line.extend_from_slice(content);
        }
        let consumed = newline.map_or(available.len(), |index| index + 1);
        reader.consume(consumed);
        if newline.is_some() {
            return Ok(sniff.map_or(Line::Read, |sniff| Line::TooLarge(sniff.finish())));
        }
    }
}

/// What an oversized line said about its id.
#[derive(Debug, PartialEq)]
enum Sniffed {
    Id(RequestId),
    /// A whole object without an `id` member.
    Notification,
    /// Not an object, cut short, or an id that is not a number or string.
    Unknown,
}

/// Reads the top-level `"id"` member of a request line from its bytes as they
/// stream past, holding at most [`MAX_ID_BYTES`] of them; nested members are
/// skipped, so an `"id"` inside `params` is never taken for the request's.
#[derive(Default)]
struct IdSniff {
    state: SniffState,
    /// The member key, or the id value, being read.
    held: Vec<u8>,
    /// Nesting inside the member value being read.
    depth: usize,
    in_string: bool,
    escaped: bool,
}

#[derive(Default)]
enum SniffState {
    /// Before the opening `{`.
    #[default]
    Open,
    /// Before a member key.
    Key,
    KeyText,
    Colon,
    Value {
        id: bool,
    },
    Done(Sniffed),
}

impl IdSniff {
    fn feed(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if matches!(self.state, SniffState::Done(_)) {
                return;
            }
            self.step(byte);
        }
    }

    fn finish(self) -> Sniffed {
        match self.state {
            SniffState::Done(sniffed) => sniffed,
            _ => Sniffed::Unknown,
        }
    }

    fn step(&mut self, byte: u8) {
        let blank = byte.is_ascii_whitespace();
        match self.state {
            SniffState::Open if byte == b'{' => self.state = SniffState::Key,
            SniffState::Key if byte == b'"' => {
                self.held.clear();
                self.state = SniffState::KeyText;
            }
            SniffState::Key if byte == b'}' => self.state = SniffState::Done(Sniffed::Notification),
            SniffState::Open | SniffState::Key | SniffState::Colon if blank => {}
            SniffState::Open | SniffState::Key => self.state = SniffState::Done(Sniffed::Unknown),
            SniffState::KeyText => self.key_byte(byte),
            SniffState::Colon if byte == b':' => {
                let id = self.held == b"id";
                self.held.clear();
                self.depth = 0;
                self.state = SniffState::Value { id };
            }
            SniffState::Colon => self.state = SniffState::Done(Sniffed::Unknown),
            SniffState::Value { id } => self.value_byte(byte, id),
            SniffState::Done(_) => {}
        }
    }

    /// A byte of a member key; only the first three are kept, enough to tell
    /// `id` from every other key.
    fn key_byte(&mut self, byte: u8) {
        if self.escaped {
            self.escaped = false;
        } else if byte == b'\\' {
            self.escaped = true;
        } else if byte == b'"' {
            self.state = SniffState::Colon;
            return;
        }
        if self.held.len() < 3 {
            self.held.push(byte);
        }
    }

    fn value_byte(&mut self, byte: u8, id: bool) {
        if self.in_string {
            if self.escaped {
                self.escaped = false;
            } else if byte == b'\\' {
                self.escaped = true;
            } else if byte == b'"' {
                self.in_string = false;
            }
        } else {
            match byte {
                b'"' => self.in_string = true,
                b'{' | b'[' => self.depth += 1,
                b'}' | b']' if self.depth > 0 => self.depth -= 1,
                b',' | b'}' if self.depth == 0 => {
                    self.state = match (id, byte) {
                        (true, _) => SniffState::Done(
                            serde_json::from_slice(self.held.trim_ascii()).map_or(Sniffed::Unknown, Sniffed::Id),
                        ),
                        (false, b',') => SniffState::Key,
                        (false, _) => SniffState::Done(Sniffed::Notification),
                    };
                    return;
                }
                _ => {}
            }
        }
        if id {
            if self.held.len() == MAX_ID_BYTES {
                self.state = SniffState::Done(Sniffed::Unknown);
                return;
            }
            self.held.push(byte);
        }
    }
}

/// `answered`: the reply carries the request's id; otherwise the connection
/// closes after it, since no caller can match it to a request.
fn request_too_large(answered: bool) -> DesktopError {
    let outcome = if answered {
        "send smaller requests"
    } else {
        "its id could not be read, so this connection closes; send smaller requests"
    };
    DesktopError::internal(format!(
        "the request line is longer than {MAX_REQUEST_BYTES} bytes and was discarded; {outcome}"
    ))
    .with_report(ErrorReport {
        reason: Some("request_too_large".to_owned()),
        ..ErrorReport::default()
    })
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
        Err(failure) => {
            let (id, failure) = *failure;
            return Some(failure_line(id, failure));
        }
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
                generation: engine.stop_paths().generation(),
            };
            queue.send(queued).err().map(|unsent| {
                let stopped = DesktopError::internal("the request dispatcher stopped");
                failure_line(Some(unsent.0.id), Failure::Engine(stopped))
            })
        }
    }
}

type ParseFailure = Box<(Option<RequestId>, Failure)>;

pub(crate) fn parse_request(text: &[u8]) -> Result<RpcRequest, ParseFailure> {
    let value: Value = serde_json::from_slice(text)
        .map_err(|error| Box::new((None, Failure::Parse(format!("parse error: {error}")))))?;
    // An unreadable id is answered with `null`, as JSON-RPC 2.0 requires.
    let id = value
        .get("id")
        .and_then(|id| serde_json::from_value(id.clone()).ok());
    serde_json::from_value(value)
        .map_err(|error| Box::new((id, Failure::InvalidRequest(format!("invalid request: {error}")))))
}

/// Writes `reply`, then every notification queued so far.
///
/// # Errors
/// The writer stopped: nobody reads the output any more.
async fn deliver(engine: &Engine, out: &Outbound, reply: String) -> Result<(), SendError<String>> {
    engine.announce_epochs();
    out.own.send(reply).await?;
    for line in engine.outbox().drain() {
        if let Some((id, fanout)) = &out.shared {
            fanout.others(*id, &line);
        }
        out.own.send(line).await?;
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

#[cfg(test)]
mod line_cap_tests {
    use tokio::io::BufReader;

    use senpi_desktop_core::protocol::RequestId;

    use super::{read_line, IdSniff, Line, Sniffed, MAX_REQUEST_BYTES};

    async fn lines(input: Vec<u8>) -> Vec<(bool, usize)> {
        let mut reader = BufReader::with_capacity(4096, input.as_slice());
        let mut line = Vec::new();
        let mut read = Vec::new();
        loop {
            match read_line(&mut reader, &mut line).await.expect("in-memory reads succeed") {
                Line::End => return read,
                Line::TooLarge(_) => read.push((true, line.len())),
                Line::Read => read.push((false, line.len())),
            }
        }
    }

    /// Sniffs `text` fed in 7-byte chunks, so tokens straddle chunk edges.
    fn sniffed(text: &str) -> Sniffed {
        let mut sniff = IdSniff::default();
        for chunk in text.as_bytes().chunks(7) {
            sniff.feed(chunk);
        }
        sniff.finish()
    }

    #[test]
    fn the_top_level_id_is_read_wherever_it_sits() {
        let big = "x".repeat(4096);
        assert_eq!(sniffed(r#"{"jsonrpc":"2.0","id":42,"method":"m","params":{}}"#), Sniffed::Id(RequestId::Number(42)));
        assert_eq!(
            sniffed(&format!(r#"{{ "params" : {{"id":1,"t":"{big}\"}}","a":[{{}}]}} , "id" : "req-7" }}"#)),
            Sniffed::Id(RequestId::String("req-7".to_owned()))
        );
        // The id is known before the rest of the line arrives.
        assert_eq!(sniffed(&format!(r#"{{"id":-3,"params":{{"t":"{big}"#)), Sniffed::Id(RequestId::Number(-3)));
    }

    #[test]
    fn a_line_without_a_readable_id_is_a_notification_or_unknown() {
        assert_eq!(sniffed(r#"{"method":"m","params":{"id":1}}"#), Sniffed::Notification);
        assert_eq!(sniffed(r#"{"method":"m","params":{"t":"#), Sniffed::Unknown);
        assert_eq!(sniffed(r#"[{"id":1}]"#), Sniffed::Unknown);
        assert_eq!(sniffed(r#"{"id":null,"method":"m"}"#), Sniffed::Unknown);
        assert_eq!(sniffed(r#"{"id" 1}"#), Sniffed::Unknown);
        assert_eq!(sniffed(&format!(r#"{{"id":"{}"}}"#, "x".repeat(super::MAX_ID_BYTES))), Sniffed::Unknown);
    }

    #[tokio::test]
    async fn an_oversized_line_is_dropped_and_the_next_line_still_reads() {
        // Given
        let mut input = vec![b'x'; MAX_REQUEST_BYTES + 1];
        input.extend_from_slice(b"\nok\n");
        // When
        let read = lines(input).await;
        // Then
        assert_eq!(read, vec![(true, 0), (false, 2)]);
    }

    #[tokio::test]
    async fn a_line_of_exactly_the_cap_is_read_whole() {
        // Given
        let mut input = vec![b'x'; MAX_REQUEST_BYTES];
        input.push(b'\n');
        // When
        let read = lines(input).await;
        // Then
        assert_eq!(read, vec![(false, MAX_REQUEST_BYTES)]);
    }

    #[tokio::test]
    async fn an_unterminated_last_line_is_still_read_or_refused() {
        assert_eq!(lines(b"tail".to_vec()).await, vec![(false, 4)]);
        assert_eq!(lines(vec![b'x'; MAX_REQUEST_BYTES + 7]).await, vec![(true, 0)]);
    }
}
