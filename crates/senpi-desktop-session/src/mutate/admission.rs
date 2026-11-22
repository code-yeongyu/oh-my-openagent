//! Safety admission and the fail-closed mutation gate.

use parking_lot::MutexGuard;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::report::ReportMode;
use senpi_desktop_core::types::Target;
use senpi_desktop_safety::{gate, FrameContext, FrameId, FrameRefusal, GateError, LockState, MutatingAction, PermissionGate, StopPolicy};

use super::{interruption, Mutation, ADMISSION_POLL, INPUT_TRANSACTION};
use crate::worker::Worker;

/// The gate's view of the session, probed once per request.
struct GateView {
    lock: LockState,
    input_granted: bool,
    latest_frame: Option<String>,
    refusal: Option<FrameRefusal>,
    identity_changed: bool,
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

    fn frame_refusal(&self, _frame: Option<&FrameId>) -> Option<FrameRefusal> {
        self.refusal
    }

    fn identity_changed(&self) -> bool {
        self.identity_changed
    }
}

impl Worker {
    /// Waits for the transaction lock, giving up when a stop or a
    /// cancellation is observed first.
    pub(super) fn admit(&self, cancelled: &dyn Fn() -> bool) -> CoreResult<MutexGuard<'static, ()>> {
        loop {
            // Before the gate: only a stop or a cancellation ends the wait;
            // the gate itself reports (and enriches) a stop path that is down.
            let is_cancelled = cancelled();
            if self.safety.supervisor.is_suspended() {
                return Err(DesktopError::from(GateError::Suspended));
            }
            if is_cancelled {
                return Err(DesktopError::new(
                    ErrorCode::Cancelled,
                    "the request was cancelled before any input was sent",
                ));
            }
            if let Some(transaction) = INPUT_TRANSACTION.try_lock_for(ADMISSION_POLL) {
                return Ok(transaction);
            }
        }
    }

    /// After the gate passed: `Suspended`, then a stop path that stopped
    /// authorizing input, then `Cancelled`; the probe runs first because a
    /// stop may race it.
    pub(super) fn stop_observed(&self, cancelled: &dyn Fn() -> bool) -> Option<DesktopError> {
        let cancelled = cancelled();
        interruption(&self.safety.supervisor, &self.stop_policy())
            .or_else(|| cancelled.then(|| DesktopError::new(
                ErrorCode::Cancelled,
                "the request was cancelled before any input was sent",
            )))
    }

    pub(crate) fn stop_policy(&self) -> StopPolicy {
        StopPolicy {
            allow_host_relay_only: self
                .options
                .as_ref()
                .is_some_and(|options| options.allow_host_relay_only_stop),
        }
    }

    /// A key chord re-checks the whole gate after its last key (gajae
    /// `keypress_checks_liveness_after_the_final_key`): a stop path that died
    /// mid-chord fails the request. Any other action fails only on a stop.
    pub(super) fn after_action<T>(&mut self, mutation: &Mutation<'_>, result: CoreResult<T>) -> CoreResult<T> {
        let stopped = if mutation.action == MutatingAction::KeyChord {
            self.gate(mutation).err()
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

    pub(super) fn gate(&mut self, mutation: &Mutation<'_>) -> CoreResult<()> {
        let policy = self.stop_policy();
        let capabilities = self.refresh_capabilities();
        mutation.fake_backend.set(capabilities.backend == "fake");
        let input_granted = input_may_proceed(&capabilities.input_permission);
        let lock = match self.backend().and_then(|backend| backend.screen_locked()) {
            Ok(true) => LockState::Locked,
            Ok(false) => LockState::Unlocked,
            Err(_) => LockState::Unknown,
        };
        let object = self.registry.report_mode() == ReportMode::Object;
        let refusal = if !mutation.action.is_coordinate() {
            None
        } else if object {
            self.frames.refusal(&mutation.target, mutation.frame_id)
        } else {
            self.frames
                .consumed(&mutation.target, mutation.frame_id)
                .then_some(FrameRefusal::Consumed)
        };
        let identity_changed = object
            && mutation.action.is_coordinate()
            && refusal.is_none()
            && self.identity_changed(&mutation.target);
        let view = GateView {
            lock,
            input_granted,
            latest_frame: self.frames.latest_id(&mutation.target).map(str::to_owned),
            refusal,
            identity_changed,
        };
        let result = gate(
            &mutation.action,
            &self.safety.supervisor,
            &policy,
            &view,
            &view,
            mutation.frame_id.map(FrameId::new),
        );
        match result {
            Err(GateError::PermissionDenied { permission }) => Err(self.backend()?.permission_denied(permission)),
            other => other.map_err(DesktopError::from),
        }
    }
}

impl Worker {
    /// Whether the window the target's latest capture recorded an identity
    /// for now belongs to another process. A window that is gone is not a
    /// change here: mapping the point reports it.
    fn identity_changed(&mut self, target_key: &str) -> bool {
        let Some(captured) = self
            .frames
            .latest_geometry(target_key)
            .and_then(|geometry| geometry.identity())
            .cloned()
        else {
            return false;
        };
        let target = Target::parse(target_key);
        if !matches!(target, Target::Window(_)) {
            return false;
        }
        self.window(&target)
            .is_ok_and(|current| current.identity.as_ref() != Some(&captured))
    }
}

/// `prompt-or-granted` (Wayland before the first input) lets the action
/// through: the RemoteDesktop portal asks the user when the first input
/// connects libei, and a refusal there fails the action itself.
fn input_may_proceed(input_permission: &str) -> bool {
    matches!(input_permission, "granted" | "prompt-or-granted")
}
