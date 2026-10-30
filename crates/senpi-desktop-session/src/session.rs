//! The session handle: starts the session thread, enqueues requests in
//! submission order, and waits for each reply under its deadline.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Weak};
use std::thread;

use parking_lot::Mutex;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopCapabilities, DesktopSessionOptions};
use tokio::time::Instant;

use crate::display_awake::DisplayAwake;
use crate::mutate::SessionSafety;
pub use crate::pending::Pending;
use crate::pending::PendingKind;
use crate::request::{Op, Response};
use crate::screen_notes::{op_display, ScreenNotes};
use crate::selection::BackendFactory;
use crate::timeouts::SessionTimeouts;
use crate::worker::Worker;

#[cfg(test)]
mod tests;

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
        signal: Arc<senpi_desktop_safety::HoldSignal>,
    },
    /// Drops the backend, acknowledges, and ends the thread.
    Close {
        ack: flume::Sender<()>,
    },
}

/// A persistent, serialized desktop session. Dropping it without
/// [`Session::close`] ends the thread once its queue drains.
pub struct Session {
    supervisor: Arc<senpi_desktop_safety::Supervisor>,
    /// `None` once `close` was requested: every later request fails `Closed`.
    queue: Mutex<Option<flume::Sender<Message>>>,
    holds: Mutex<Vec<Weak<senpi_desktop_safety::HoldSignal>>>,
    capabilities: Arc<Mutex<DesktopCapabilities>>,
    timeouts: SessionTimeouts,
    awake: Arc<DisplayAwake>,
    notes: ScreenNotes,
    _stop_observer: Arc<dyn Fn() + Send + Sync>,
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
        let supervisor = Arc::clone(&safety.supervisor);
        let awake = Arc::new(DisplayAwake::default());
        let stop_observer = awake.observe_stops(&supervisor);
        let notes = ScreenNotes::default();
        let screen = (Arc::clone(&awake), notes.clone());
        thread::Builder::new()
            .name(THREAD_NAME.to_owned())
            .spawn(move || {
                let worker = Worker::new(Box::new(factory), shared, safety, screen);
                // `start` is blocked on this receiver until it arrives.
                ready_tx.send(()).unwrap_or(());
                serve(worker, &requests);
            })
            .map_err(|error| DesktopError::internal(format!("cannot start {THREAD_NAME}: {error}")))?;
        ready_rx
            .recv()
            .map_err(|_| DesktopError::internal(format!("{THREAD_NAME} died while building the backend")))?;
        Ok(Self {
            supervisor,
            queue: Mutex::new(Some(queue)),
            holds: Mutex::new(Vec::new()),
            capabilities,
            timeouts,
            awake,
            notes,
            _stop_observer: stop_observer,
        })
    }

    /// The latest capabilities the session thread observed, with the display
    /// sleep read live; never waits on a busy backend.
    #[must_use]
    pub fn capabilities(&self) -> DesktopCapabilities {
        let mut capabilities = self.capabilities.lock().clone();
        if let Some(state) = self.notes.live(None) {
            capabilities.display_asleep = state.display_asleep;
        }
        capabilities
    }

    /// Opens or reconfigures the session. Cursor-only changes preserve the
    /// backend, refs, frames, stop latch and control grant.
    /// The reply is [`Response::Capabilities`].
    pub fn open(&self, options: DesktopSessionOptions) -> Pending {
        self.enqueue(|reply| Message::Open { options, reply })
    }

    /// Enqueues `op` behind every earlier request.
    pub fn submit(&self, op: Op) -> Pending {
        let budget = self.timeouts.budget_for(&op);
        let is_hold = matches!(op, Op::HoldKeys(_) | Op::HoldMouse(_));
        let display = op_display(&op);
        let signal = self.supervisor.hold_signal();
        let mut pending = self.enqueue(|reply| {
            let mut holds = self.holds.lock();
            holds.retain(|hold| hold.strong_count() > 0);
            holds.push(Arc::downgrade(&signal));
            Message::Op { op, reply, signal: Arc::clone(&signal) }
        });
        pending.cancellation = Some(crate::cancel_on_drop::CancelOnDrop(signal));
        pending.budget = budget;
        pending.deadline = Instant::now() + budget;
        pending.release_budget = is_hold.then_some(self.timeouts.close);
        pending.notes = Some((self.notes.clone(), display));
        pending
    }

    /// Releases the backend after every earlier request, and the
    /// display-awake hold at once. Idempotent: a second close answers `Unit`.
    pub fn close(&self) -> Pending {
        let mut queue = self.queue.lock();
        self.awake.close();
        self.cancel_holds();
        let Some(queue) = queue.take() else {
            return Pending::ready(Ok(Response::Unit));
        };
        let (ack, acked) = flume::bounded(1);
        match queue.send(Message::Close { ack }) {
            Ok(()) => Pending::new(PendingKind::Close(acked), self.timeouts.close),
            // The thread is gone, so the backend is already released.
            Err(_) => Pending::ready(Ok(Response::Unit)),
        }
    }

    fn cancel_holds(&self) {
        for hold in self.holds.lock().drain(..).filter_map(|hold| hold.upgrade()) {
            hold.cancel();
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

impl Drop for Session {
    fn drop(&mut self) {
        self.awake.close();
        self.cancel_holds();
    }
}

/// The next request; an idle wait ends early when the display-awake grace runs out.
fn next(worker: &Worker, requests: &flume::Receiver<Message>) -> Option<Message> {
    loop {
        let Some(deadline) = worker.awake.deadline() else {
            return requests.recv().ok();
        };
        match requests.recv_deadline(deadline) {
            Ok(message) => return Some(message),
            Err(flume::RecvTimeoutError::Timeout) => worker.awake.expire(std::time::Instant::now()),
            Err(flume::RecvTimeoutError::Disconnected) => return None,
        }
    }
}

fn serve(mut worker: Worker, requests: &flume::Receiver<Message>) {
    while let Some(message) = next(&worker, requests) {
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
            Message::Open { options, reply } => {
                let opened = guarded(|| Ok(Response::Capabilities(worker.open(options))));
                worker.begin_activity();
                worker.awake.finish(std::time::Instant::now());
                (reply, opened)
            }
            Message::Op { op, reply, signal } => {
                // `$/cancel` or a deadline drops the waiter: that is the
                // request's cancellation signal while it runs.
                worker.hold_signal = Some(signal);
                worker.dispatch(
                    op,
                    &|| reply.is_disconnected(),
                    |result| reply.send(result).is_ok(),
                );
                worker.hold_signal = None;
                continue;
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
