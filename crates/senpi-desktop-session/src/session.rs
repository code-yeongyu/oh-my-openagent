//! The session handle: starts the session thread, enqueues requests in
//! submission order, and waits for each reply under its deadline.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopCapabilities, DesktopSessionOptions};
use tokio::time::{timeout_at, Instant};

use crate::mutate::SessionSafety;
use crate::request::{Op, Response};
use crate::selection::BackendFactory;
use crate::timeouts::SessionTimeouts;
use crate::worker::Worker;

pub const THREAD_NAME: &str = "senpi-desktop-session";

type Reply = flume::Sender<CoreResult<Response>>;

enum Message {
    Open {
        options: DesktopSessionOptions,
        reply: Reply,
    },
    Op {
        op: Op,
        reply: Reply,
    },
    /// Drops the backend, acknowledges, and ends the thread.
    Close {
        ack: flume::Sender<()>,
    },
}

/// A persistent, serialized desktop session. Dropping it without
/// [`Session::close`] ends the thread once its queue drains.
pub struct Session {
    /// `None` once `close` was requested: every later request fails `Closed`.
    queue: Mutex<Option<flume::Sender<Message>>>,
    capabilities: Arc<Mutex<DesktopCapabilities>>,
    timeouts: SessionTimeouts,
}

impl Session {
    /// [`Session::start_supervised`] under [`SessionSafety::fail_closed`]:
    /// every mutating request is refused `StopPathUnavailable`.
    ///
    /// # Errors
    /// See [`Session::start_supervised`].
    pub fn start(factory: impl BackendFactory, timeouts: SessionTimeouts) -> CoreResult<Self> {
        Self::start_supervised(factory, timeouts, SessionSafety::fail_closed())
    }

    /// Starts the session thread and waits until it has built the probe
    /// backend, so [`Session::capabilities`] is truthful from the first call.
    /// Mutating requests are gated on `safety.supervisor` and audited to
    /// `safety.audit`.
    ///
    /// # Errors
    /// `Internal` when the thread cannot be spawned or dies while building the
    /// backend. A backend that cannot be constructed is not an error: the
    /// session reports `DesktopCapabilities::unavailable()`.
    pub fn start_supervised(
        factory: impl BackendFactory,
        timeouts: SessionTimeouts,
        safety: SessionSafety,
    ) -> CoreResult<Self> {
        let capabilities = Arc::new(Mutex::new(DesktopCapabilities::unavailable()));
        let (queue, requests) = flume::unbounded();
        let (ready_tx, ready_rx) = flume::bounded(1);
        let shared = Arc::clone(&capabilities);
        thread::Builder::new()
            .name(THREAD_NAME.to_owned())
            .spawn(move || {
                let worker = Worker::new(Box::new(factory), shared, safety);
                // `start` is blocked on this receiver until it arrives.
                ready_tx.send(()).unwrap_or(());
                serve(worker, &requests);
            })
            .map_err(|error| DesktopError::internal(format!("cannot start {THREAD_NAME}: {error}")))?;
        ready_rx
            .recv()
            .map_err(|_| DesktopError::internal(format!("{THREAD_NAME} died while building the backend")))?;
        Ok(Self {
            queue: Mutex::new(Some(queue)),
            capabilities,
            timeouts,
        })
    }

    /// The latest capabilities the session thread observed; never waits on a
    /// busy backend.
    #[must_use]
    pub fn capabilities(&self) -> DesktopCapabilities {
        self.capabilities.lock().clone()
    }

    /// Re-creates the backend for `options.display` and opens the session.
    /// The reply is [`Response::Capabilities`].
    pub fn open(&self, options: DesktopSessionOptions) -> Pending {
        self.enqueue(|reply| Message::Open { options, reply })
    }

    /// Enqueues `op` behind every earlier request.
    pub fn submit(&self, op: Op) -> Pending {
        self.enqueue(|reply| Message::Op { op, reply })
    }

    /// Releases the backend after every earlier request. Idempotent: a second
    /// close answers `Unit` at once.
    pub fn close(&self) -> Pending {
        let Some(queue) = self.queue.lock().take() else {
            return Pending::ready(Ok(Response::Unit));
        };
        let (ack, acked) = flume::bounded(1);
        match queue.send(Message::Close { ack }) {
            Ok(()) => Pending::new(PendingKind::Close(acked), self.timeouts.close),
            // The thread is gone, so the backend is already released.
            Err(_) => Pending::ready(Ok(Response::Unit)),
        }
    }

    fn enqueue(&self, message: impl FnOnce(Reply) -> Message) -> Pending {
        let queue = self.queue.lock();
        let Some(queue) = queue.as_ref() else {
            return Pending::ready(Err(DesktopError::closed()));
        };
        let (reply, replied) = flume::bounded(1);
        match queue.send(message(reply)) {
            Ok(()) => Pending::new(PendingKind::Reply(replied), self.timeouts.operation),
            Err(_) => Pending::ready(Err(DesktopError::internal(format!(
                "{THREAD_NAME} stopped unexpectedly"
            )))),
        }
    }
}

fn serve(mut worker: Worker, requests: &flume::Receiver<Message>) {
    while let Ok(message) = requests.recv() {
        let (reply, result) = match message {
            Message::Close { ack } => {
                drop(worker);
                // A close waiter that timed out no longer listens.
                ack.send(()).unwrap_or(());
                return;
            }
            // A waiter that already gave up (deadline or `$/cancel`) dropped
            // its receiver: its request must not reach the desktop.
            Message::Open { reply, .. } | Message::Op { reply, .. } if reply.is_disconnected() => continue,
            Message::Open { options, reply } => (
                reply,
                guarded(|| Ok(Response::Capabilities(worker.open(options)))),
            ),
            Message::Op { op, reply } => {
                // `$/cancel` or a deadline drops the waiter: that is the
                // request's cancellation signal while it runs.
                let result = guarded(|| worker.process(op, &|| reply.is_disconnected()));
                (reply, result)
            }
        };
        // The waiter may give up while the request runs; its result is then moot.
        reply.send(result).unwrap_or(());
    }
}

/// Runs `request`, turning a panic into `Internal`.
pub(crate) fn guarded<T>(request: impl FnOnce() -> CoreResult<T>) -> CoreResult<T> {
    catch_unwind(AssertUnwindSafe(request))
        .unwrap_or_else(|_| Err(DesktopError::internal("the desktop backend panicked")))
}

/// The reply to one enqueued request. Dropping it abandons the request: if
/// the session thread has not started it yet, it never runs.
pub struct Pending {
    kind: PendingKind,
    deadline: Instant,
    budget: Duration,
}

enum PendingKind {
    Ready(Box<CoreResult<Response>>),
    Reply(flume::Receiver<CoreResult<Response>>),
    Close(flume::Receiver<()>),
}

impl Pending {
    fn new(kind: PendingKind, budget: Duration) -> Self {
        Self {
            kind,
            deadline: Instant::now() + budget,
            budget,
        }
    }

    fn ready(result: CoreResult<Response>) -> Self {
        Self::new(PendingKind::Ready(Box::new(result)), Duration::ZERO)
    }

    /// # Errors
    /// The request's own error, `Timeout` past the deadline, or `Internal`
    /// when the session thread ended without replying.
    pub async fn wait(self) -> CoreResult<Response> {
        let timed_out =
            |what: &str| DesktopError::timeout(format!("{what} within {} ms", self.budget.as_millis()));
        let lost = || DesktopError::internal(format!("{THREAD_NAME} ended without replying"));
        match self.kind {
            PendingKind::Ready(result) => *result,
            PendingKind::Reply(replied) => match timeout_at(self.deadline, replied.recv_async()).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err(lost()),
                Err(_) => Err(timed_out("desktop operation did not complete")),
            },
            PendingKind::Close(acked) => match timeout_at(self.deadline, acked.recv_async()).await {
                Ok(Ok(())) => Ok(Response::Unit),
                Ok(Err(_)) => Err(lost()),
                Err(_) => Err(timed_out("the desktop backend was not released")),
            },
        }
    }
}
