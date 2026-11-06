//! The reply to one enqueued session request, awaited under its deadline.

use std::sync::Arc;
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::holds::reports_release_failure;
use senpi_desktop_core::types::DisplaySelector;
use tokio::time::{timeout_at, Instant};

use crate::request::Response;
use crate::screen_notes::ScreenNotes;
use crate::session::THREAD_NAME;

/// The reply to one enqueued request. Dropping it abandons the request: if
/// the session thread has not started it yet, it never runs.
pub struct Pending {
    pub(crate) cancellation: Option<crate::cancel_on_drop::CancelOnDrop>,
    pub(crate) kind: PendingKind,
    pub(crate) deadline: Instant,
    pub(crate) budget: Duration,
    pub(crate) release_budget: Option<Duration>,
    /// Names a lock or display sleep in this request's timeout.
    pub(crate) notes: Option<(ScreenNotes, Option<DisplaySelector>)>,
}

pub(crate) enum PendingKind {
    Ready(Box<CoreResult<Response>>),
    Reply(flume::Receiver<CoreResult<Response>>),
    Close(flume::Receiver<()>),
}

impl Pending {
    pub(crate) fn new(kind: PendingKind, budget: Duration) -> Self {
        Self {
            cancellation: None,
            kind,
            deadline: Instant::now() + budget,
            budget,
            release_budget: None,
            notes: None,
        }
    }

    pub(crate) fn ready(result: CoreResult<Response>) -> Self {
        Self::new(PendingKind::Ready(Box::new(result)), Duration::ZERO)
    }

    /// The engine cancels a hold without dropping its completion receiver.
    pub fn hold_signal(&self) -> Option<Arc<senpi_desktop_safety::HoldSignal>> {
        self.release_budget?;
        self.cancellation.as_ref().map(|cancel| Arc::clone(&cancel.0))
    }

    /// # Errors
    /// The request's own error, `Timeout` past the deadline, or `Internal`
    /// when the session thread ended without replying.
    pub async fn wait(self) -> CoreResult<Response> {
        let _cancellation = self.cancellation;
        let notes = self.notes;
        let timed_out = |what: &str| {
            let error = DesktopError::timeout(format!("{what} within {} ms", self.budget.as_millis()));
            match &notes {
                Some((notes, display)) => notes.explain(error, display.as_ref()),
                None => error,
            }
        };
        let lost = || DesktopError::internal(format!("{THREAD_NAME} ended without replying"));
        match self.kind {
            PendingKind::Ready(result) => *result,
            PendingKind::Reply(replied) => match timeout_at(self.deadline, replied.recv_async()).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err(lost()),
                Err(_) => {
                    if let (Some(cancel), Some(budget)) = (&_cancellation, self.release_budget) {
                        cancel.0.cancel();
                        match tokio::time::timeout(budget, replied.recv_async()).await {
                            Err(_) => return Err(timed_out("held input release did not complete")),
                            Ok(Ok(Err(error))) if reports_release_failure(&error) => return Err(error),
                            // A hold that finished or released cleanly after its deadline still
                            // answers Timeout: the caller's budget is what was exceeded.
                            Ok(_) => {}
                        }
                    }
                    Err(timed_out("desktop operation did not complete"))
                }
            },
            PendingKind::Close(acked) => match timeout_at(self.deadline, acked.recv_async()).await {
                Ok(Ok(())) => Ok(Response::Unit),
                Ok(Err(_)) => Err(lost()),
                Err(_) => Err(timed_out("the desktop backend was not released")),
            },
        }
    }
}
