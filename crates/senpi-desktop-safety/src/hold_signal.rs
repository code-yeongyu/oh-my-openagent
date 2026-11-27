//! Request-local interruption of bounded holds, without polling.

use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::{Condvar, Mutex};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use crate::Supervisor;

#[cfg(test)]
mod tests;

/// The request owns this signal; the supervisor keeps only a weak reference.
/// Cancellation and stop notifications take the same mutex as the waiter,
/// so a notification between checking state and sleeping cannot be lost.
pub struct HoldSignal {
    state: Mutex<State>,
    changed: Condvar,
    stop_epoch: u64,
}

#[derive(Default)]
struct State {
    cancelled: bool,
    input_active: bool,
    releasing: bool,
    published: bool,
}

struct InputScope<'a>(&'a HoldSignal);

impl Drop for InputScope<'_> {
    fn drop(&mut self) {
        self.0.state.lock().input_active = false;
        self.0.changed.notify_all();
    }
}

impl HoldSignal {
    /// The scope in which a backend may have physical input held.
    pub fn with_input<T>(
        &self,
        supervisor: &Supervisor,
        operation: impl FnOnce() -> CoreResult<T>,
    ) -> CoreResult<T> {
        let active = {
            let mut state = self.state.lock();
            if state.releasing || state.cancelled {
                false
            } else {
                self.check_state(supervisor, &state)?;
                state.input_active = true;
                true
            }
        };
        let result = if active {
            let scope = InputScope(self);
            let result = operation();
            // Backend hold methods release all pressed input before returning.
            drop(scope);
            result
        } else {
            Err(DesktopError::new(ErrorCode::Cancelled, "input release requested"))
        };
        let mut state = self.state.lock();
        while (state.releasing || supervisor.stop_pending()) && !state.published && !state.cancelled {
            self.changed.wait(&mut state);
        }
        self.check_state(supervisor, &state)?;
        result
    }

    pub(crate) fn new(stop_epoch: u64) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
            stop_epoch,
        })
    }

    /// Abandon the request, including a dropped waiter or an expired deadline.
    pub fn cancel(&self) {
        self.state.lock().cancelled = true;
        self.changed.notify_all();
    }

    pub(crate) fn stopped(&self) {
        self.state.lock().published = true;
        self.changed.notify_all();
    }

    pub(crate) fn request_release(&self) {
        self.state.lock().releasing = true;
        self.changed.notify_all();
    }

    pub(crate) fn await_release_until(&self, deadline: Option<Instant>) -> bool {
        let mut state = self.state.lock();
        while state.input_active {
            match deadline {
                Some(deadline) => {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() { return false; }
                    self.changed.wait_for(&mut state, remaining);
                }
                None => self.changed.wait(&mut state),
            }
        }
        true
    }

    /// Suspension takes precedence over cancellation, even after a quick reset.
    ///
    /// # Errors
    /// `Suspended` after a safety stop, otherwise `Cancelled` after abandonment.
    pub fn check(&self, supervisor: &Supervisor) -> CoreResult<()> {
        self.check_state(supervisor, &self.state.lock())
    }

    fn check_state(&self, supervisor: &Supervisor, state: &State) -> CoreResult<()> {
        if supervisor.is_suspended() || supervisor.stop_epoch() != self.stop_epoch {
            Err(DesktopError::new(ErrorCode::Suspended, "input was suspended during the hold"))
        } else if state.cancelled || (state.releasing && state.input_active) {
            Err(DesktopError::new(ErrorCode::Cancelled, "the hold request was cancelled"))
        } else {
            Ok(())
        }
    }

    /// Wait for the hold duration or interruption. Spurious wakeups recheck
    /// state and the original deadline, rather than restarting the duration.
    ///
    /// # Errors
    /// See [`Self::check`].
    pub fn wait(&self, supervisor: &Supervisor, duration: Duration) -> CoreResult<()> {
        let deadline = Instant::now() + duration;
        let mut state = self.state.lock();
        loop {
            self.check_state(supervisor, &state)?;
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(());
            }
            #[cfg(any(test, feature = "test-support"))]
            supervisor.hold_waiting_for_test();
            self.changed.wait_for(&mut state, remaining);
        }
    }
}
