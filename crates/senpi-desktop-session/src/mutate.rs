//! The single choke point of every mutating request: admission to the
//! process-wide transaction lock, the fail-closed [`gate`], then one input
//! transaction (focus/cursor capture, the action under `catch_unwind`,
//! `release_all` on failure or suspension, the focus/cursor restore), then
//! exactly one [`AuditEvent`]. Read-only requests never pass here.
//!
//! A stop or a cancellation observed at admission or just before the action
//! sends no input; suspension always wins over cancellation (gajae
//! `execute_one`).

use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::{Mutex, MutexGuard};
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::protocol_results::AuditEvent;
use senpi_desktop_safety::{
    gate, FrameContext, FrameId, GateError, LockState, MonotonicClock, MutatingAction, PermissionGate,
    StopPolicy, Supervisor,
};

use crate::audit::audit_event;
use crate::restore::{Guard, TransactionError};
use crate::session::guarded;
use crate::worker::Worker;

/// Serializes input transactions across every session of the process
/// (gajae `INPUT_TRANSACTION`): capture through restore is never interleaved.
static INPUT_TRANSACTION: Mutex<()> = parking_lot::const_mutex(());

/// How long admission waits on a held transaction lock between cancellation
/// checks.
const ADMISSION_POLL: Duration = Duration::from_millis(1);

/// What the session thread needs to gate input and report it.
pub struct SessionSafety {
    /// The engine's kill switch; every mutating request is gated on it.
    pub supervisor: Arc<Supervisor>,
    /// Receives one [`AuditEvent`] per mutating request, success or failure;
    /// the engine forwards it as the `audit` notification.
    pub audit: Box<dyn Fn(&AuditEvent) + Send>,
}

impl SessionSafety {
    /// A private supervisor no stop path can reach: every mutating request is
    /// refused `StopPathUnavailable`, and no one consumes its audit events.
    #[must_use]
    pub fn fail_closed() -> Self {
        Self {
            supervisor: Arc::new(Supervisor::new(Arc::new(MonotonicClock::new()))),
            audit: Box::new(|_| {}),
        }
    }
}

/// One mutating request as the gate, the transaction, and the audit see it.
pub(crate) struct Mutation<'a> {
    pub(crate) action: MutatingAction,
    /// `desktop`, a window id, or (AX requests) the window key of the ref.
    pub(crate) target: String,
    pub(crate) delivery: DeliveryMode,
    /// The capture the request's coordinates are pixels of.
    pub(crate) frame_id: Option<&'a str>,
    /// Typed text or an AX value: audited by length and hash only.
    pub(crate) text: Option<&'a str>,
    pub(crate) keys: Option<&'a [String]>,
}

impl Mutation<'_> {
    pub(crate) const fn new(action: MutatingAction, target: String, delivery: DeliveryMode) -> Self {
        Self {
            action,
            target,
            delivery,
            frame_id: None,
            text: None,
            keys: None,
        }
    }
}

/// The gate's view of the session, probed once per request.
struct GateView {
    lock: LockState,
    input_granted: bool,
    latest_frame: Option<String>,
}

impl PermissionGate for GateView {
    fn input_granted(&self) -> bool {
        self.input_granted
    }
}

impl FrameContext for GateView {
    fn screen_locked(&self) -> LockState {
        self.lock
    }

    fn is_latest(&self, frame: &FrameId) -> bool {
        self.latest_frame.as_deref() == Some(frame.as_str())
    }
}

impl Worker {
    /// Runs `act` as one gated, audited input transaction. The host performs
    /// no cleanup: release and restore all happen here.
    ///
    /// `cancelled` reports that the request's waiter gave up (`$/cancel`).
    ///
    /// # Errors
    /// `Suspended` / `Cancelled` observed before the action, the gate's
    /// refusal, the action's error, a stop that landed while it ran, or
    /// `FocusRestoreFailed` / `CursorRestoreFailed` naming the error they
    /// followed.
    pub(crate) fn mutate<T>(
        &mut self,
        mutation: &Mutation<'_>,
        cancelled: &dyn Fn() -> bool,
        act: impl FnOnce(&mut Self) -> CoreResult<T>,
    ) -> CoreResult<(T, AuditEvent)> {
        let started = Instant::now();
        let (result, focus_restored) = match self.admit(cancelled) {
            Ok(_transaction) => self.transaction(mutation, cancelled, act),
            Err(stopped) => (Err(TransactionError::Primary(stopped)), None),
        };
        let result = result.map_err(DesktopError::from);
        let code = result.as_ref().err().map(|error| error.code);
        let event = audit_event(mutation, code, focus_restored, started.elapsed());
        (self.safety.audit)(&event);
        self.persist_audit(&event, result.as_ref().err());
        result.map(|value| (value, event))
    }

    /// The gate and the transaction proper; `focus_restored` is `None` when
    /// nothing was captured to restore.
    pub(crate) fn transaction<T>(
        &mut self,
        mutation: &Mutation<'_>,
        cancelled: &dyn Fn() -> bool,
        act: impl FnOnce(&mut Self) -> CoreResult<T>,
    ) -> (Result<T, TransactionError>, Option<bool>) {
        if let Err(refused) = self.gate(mutation) {
            return (Err(TransactionError::Primary(refused.into())), None);
        }
        let guard = match Guard::begin(self, mutation.action, mutation.delivery) {
            Ok(guard) => guard,
            Err(error) => return (Err(TransactionError::Primary(error)), None),
        };
        let mut result = match self.stop_observed(cancelled) {
            Some(stopped) => Err(stopped),
            None => guarded(|| act(self)),
        };
        if result.is_ok() {
            result = self.after_action(mutation, result);
        }
        if let Err(primary) = &mut result {
            // Recorded on the primary error, never in place of it.
            if let Err(release) = guarded(|| self.backend()?.release_all()) {
                primary.message = format!("{}; releasing held input also failed: {release}", primary.message);
            }
        }
        guard.restore(self, result)
    }

    /// Waits for the transaction lock, giving up when a stop or a
    /// cancellation is observed first.
    fn admit(&self, cancelled: &dyn Fn() -> bool) -> CoreResult<MutexGuard<'static, ()>> {
        loop {
            if let Some(stopped) = self.stop_observed(cancelled) {
                return Err(stopped);
            }
            if let Some(transaction) = INPUT_TRANSACTION.try_lock_for(ADMISSION_POLL) {
                return Ok(transaction);
            }
        }
    }

    /// `Suspended` before `Cancelled`: the probe runs first because a stop
    /// may race it.
    fn stop_observed(&self, cancelled: &dyn Fn() -> bool) -> Option<DesktopError> {
        let cancelled = cancelled();
        if self.safety.supervisor.is_suspended() {
            Some(DesktopError::from(GateError::Suspended))
        } else if cancelled {
            Some(DesktopError::new(
                ErrorCode::Cancelled,
                "the request was cancelled before any input was sent",
            ))
        } else {
            None
        }
    }

    /// A key chord re-checks the whole gate after its last key (gajae
    /// `keypress_checks_liveness_after_the_final_key`): a stop path that died
    /// mid-chord fails the request. Any other action fails only on a stop.
    fn after_action<T>(&mut self, mutation: &Mutation<'_>, result: CoreResult<T>) -> CoreResult<T> {
        let stopped = if mutation.action == MutatingAction::KeyChord {
            self.gate(mutation).err().map(DesktopError::from)
        } else {
            self.safety.supervisor.is_suspended().then(|| {
                DesktopError::new(
                    ErrorCode::Suspended,
                    "input was suspended while the action ran; held input was released",
                )
            })
        };
        stopped.map_or(result, Err)
    }

    fn gate(&mut self, mutation: &Mutation<'_>) -> Result<(), GateError> {
        let policy = StopPolicy {
            allow_host_relay_only: self
                .options
                .as_ref()
                .is_some_and(|options| options.allow_host_relay_only_stop),
        };
        let input_granted = input_may_proceed(&self.refresh_capabilities().input_permission);
        let lock = match self.backend().and_then(|backend| backend.screen_locked()) {
            Ok(true) => LockState::Locked,
            Ok(false) => LockState::Unlocked,
            Err(_) => LockState::Unknown,
        };
        let view = GateView {
            lock,
            input_granted,
            latest_frame: self.frames.latest_id(&mutation.target).map(str::to_owned),
        };
        gate(
            &mutation.action,
            &self.safety.supervisor,
            &policy,
            &view,
            &view,
            mutation.frame_id.map(FrameId::new),
        )
    }
}

/// `prompt-or-granted` (Wayland before the first input) lets the action
/// through: the RemoteDesktop portal asks the user when the first input
/// connects libei, and a refusal there fails the action itself.
fn input_may_proceed(input_permission: &str) -> bool {
    matches!(input_permission, "granted" | "prompt-or-granted")
}

#[cfg(test)]
mod permission_tests;
#[cfg(test)]
mod stop_tests;
#[cfg(test)]
mod tests;
