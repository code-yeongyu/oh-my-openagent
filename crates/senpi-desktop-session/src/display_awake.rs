//! Keeps the display awake while the agent operates the desktop, as
//! oh-my-pi's `DisplayAwake` (`crates/pi-natives/src/desktop/mod.rs`) does:
//! every request the agent makes, except `capabilities`, `control.state` and
//! the `stopPath.*` methods, takes the backend's hold; it lasts until [`GRACE`]
//! after the last such request finished, and `session.close`, a disconnect
//! (the session dropped) or a committed stop releases it at once.

use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use senpi_desktop_core::backend::DisplayAwakeHold;
use senpi_desktop_safety::Supervisor;

use crate::request::Op;

#[cfg(test)]
mod tests;

/// How long the display stays awake after the last activity request.
pub(crate) const GRACE: Duration = Duration::from_secs(60);

/// The hold, shared by the session thread (which takes it), the session
/// handle (close and drop) and the supervisor's stop observer.
#[derive(Default)]
pub(crate) struct DisplayAwake(Mutex<State>);

#[derive(Default)]
struct State {
    hold: Option<DisplayAwakeHold>,
    /// When the hold lapses; `None` while a request runs or nothing is held.
    until: Option<Instant>,
    /// The session closed or was dropped: nothing takes the hold again.
    closed: bool,
}

/// Status reads and stop-path methods are not the agent operating the
/// desktop; `capabilities` and `stopPath.*` never reach the session thread.
pub(crate) const fn is_activity(op: &Op) -> bool {
    !matches!(op, Op::ControlState)
}

impl DisplayAwake {
    /// An activity request starts: takes the hold unless one is held or the
    /// session closed, and keeps it from lapsing while the request runs.
    pub(crate) fn begin(&self, start: impl FnOnce() -> Option<DisplayAwakeHold>) {
        let mut state = self.0.lock();
        if state.closed {
            return;
        }
        if state.hold.is_none() {
            state.hold = start();
        }
        state.until = None;
    }

    /// The activity request finished at `now`; the hold lapses at
    /// `now + GRACE` unless another request starts first.
    pub(crate) fn finish(&self, now: Instant) {
        let mut state = self.0.lock();
        if state.hold.is_some() {
            state.until = Some(now + GRACE);
        }
    }

    pub(crate) fn deadline(&self) -> Option<Instant> {
        self.0.lock().until
    }

    pub(crate) fn expire(&self, now: Instant) {
        let released = {
            let mut state = self.0.lock();
            if state.until.is_some_and(|until| until <= now) {
                state.until = None;
                state.hold.take()
            } else {
                None
            }
        };
        drop(released);
    }

    /// A committed stop drops the hold now; a later request takes a new one.
    pub(crate) fn release(&self) {
        let released = {
            let mut state = self.0.lock();
            state.until = None;
            state.hold.take()
        };
        drop(released);
    }

    /// `session.close` or a disconnect: drops the hold for good.
    pub(crate) fn close(&self) {
        self.0.lock().closed = true;
        self.release();
    }

    /// Registers [`Self::release`] for every committed stop; the supervisor
    /// keeps the observer only while the returned handle lives.
    pub(crate) fn observe_stops(
        self: &Arc<Self>,
        supervisor: &Supervisor,
    ) -> Arc<dyn Fn() + Send + Sync> {
        let awake = Arc::downgrade(self);
        let observer: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            if let Some(awake) = awake.upgrade() {
                awake.release();
            }
        });
        supervisor.observe_stops(&observer);
        observer
    }
}
