//! The single choke point of every mutating request: admission to the
//! process-wide transaction lock, the fail-closed [`gate`], then one input
//! transaction (focus/cursor capture, the action under `catch_unwind`,
//! `release_all` on failure or suspension, the focus/cursor restore), then
//! exactly one [`AuditEvent`]. Read-only requests never pass here.
//!
//! The machine-wide [`crate::lock::InteractionLock`] is taken after every
//! admission wait: a foreground transaction holds it from the capture through
//! the restore, background exec only around the dispatch.
//!
//! A stop or a cancellation observed at admission or just before the action
//! sends no input; suspension always wins over cancellation (gajae
//! `execute_one`).

use std::cell::Cell;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::{Mutex, MutexGuard};
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode, ErrorReport, TccPermission};
use senpi_desktop_core::protocol_results::AuditEvent;
use senpi_desktop_core::report::{ActionRoute, Disposition, ReportMode};
use senpi_desktop_core::types::Target;
use senpi_desktop_safety::{
    gate, FrameContext, FrameId, FrameRefusal, GateError, LockState, MonotonicClock, MutatingAction, PermissionGate,
    StopPathReason, StopPolicy, Supervisor,
};

use crate::audit::audit_event;
use crate::grant::ControlSlot;
use crate::lock::Held;
use crate::report::{error_report, ReportExtras, Stage};
use crate::restore::{Guard, TransactionError};
use crate::session::guarded;
use crate::timings::{StageClock, TimedStage};
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
    /// Who holds the foreground-control grant. The engine passes
    /// [`ControlSlot::process_wide`] so its sessions share one slot.
    pub control_slot: Arc<ControlSlot>,
}

impl SessionSafety {
    /// A private supervisor no stop path can reach: every mutating request is
    /// refused `StopPathUnavailable`, and no one consumes its audit events.
    #[must_use]
    pub fn fail_closed() -> Self {
        Self {
            supervisor: Arc::new(Supervisor::new(Arc::new(MonotonicClock::new()))),
            audit: Box::new(|_| {}),
            control_slot: ControlSlot::process_wide(),
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
    /// `consume: true`: once input was sent, `frame_id` takes no more input.
    pub(crate) consume: bool,
    /// Typed text or an AX value: audited by length and hash only.
    pub(crate) text: Option<&'a str>,
    /// Fully delivered Unicode scalars, updated inside an interruptible
    /// backend call while this single transaction owns the input lock.
    pub(crate) text_delivered: Cell<u32>,
    pub(crate) keys: Option<&'a [String]>,
    /// How far the transaction got; decides the object-mode disposition.
    pub(crate) stage: Cell<Stage>,
    /// Stage durations, reported only in `trace: true` sessions.
    pub(crate) timings: StageClock,
    /// Set by the gate: the fake backend joins the machine-wide lock only
    /// when a test names its directory.
    pub(crate) fake_backend: Cell<bool>,
}

impl Mutation<'_> {
    pub(crate) const fn new(action: MutatingAction, target: String, delivery: DeliveryMode) -> Self {
        Self {
            action,
            target,
            delivery,
            frame_id: None,
            consume: false,
            text: None,
            text_delivered: Cell::new(0),
            keys: None,
            stage: Cell::new(Stage::Admission),
            timings: StageClock::new(),
            fake_backend: Cell::new(false),
        }
    }
}

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

/// A foreground transaction holds the machine-wide lock from its capture
/// through its restore; background exec only around its dispatch.
fn locks_whole_transaction(mutation: &Mutation<'_>) -> bool {
    mutation.delivery == DeliveryMode::Foreground || matches!(route(mutation), Some(ActionRoute::ForegroundHid))
}

/// The channel a mutating request's input takes; `None` for a request that
/// sends no input event (`clipboard.write`).
fn route(mutation: &Mutation<'_>) -> Option<ActionRoute> {
    match mutation.action {
        MutatingAction::AxPerform
        | MutatingAction::AxSetValue
        | MutatingAction::AxFocus
        | MutatingAction::AxClick
        | MutatingAction::AxTypeText
        | MutatingAction::MenuSelect => Some(ActionRoute::Ax),
        MutatingAction::ClipboardWrite => None,
        _ => match (Target::parse(&mutation.target), mutation.delivery) {
            (Target::Window(_), DeliveryMode::Background) => Some(ActionRoute::BackgroundWindow),
            _ => Some(ActionRoute::ForegroundHid),
        },
    }
}

/// The report of a refusal: how it settled, plus the `reason` (and, for a
/// change judged after input was sent, the disposition) its error carried.
fn settled_report(
    preset: Option<ErrorReport>,
    primary: Option<ErrorCode>,
    stage: Stage,
    event: &AuditEvent,
) -> ErrorReport {
    let mut report = error_report(primary, stage, event);
    if let Some(preset) = preset {
        report.reason = preset.reason;
        report.disposition = preset.disposition.or(report.disposition);
    }
    report
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
        self.report_extras.set(None);
        let (result, focus_restored) = match self.admit(cancelled) {
            Ok(_transaction) => self.transaction(mutation, cancelled, act),
            Err(stopped) => (Err(TransactionError::Primary(stopped)), None),
        };
        let primary = match &result {
            Ok(_) => None,
            Err(TransactionError::Primary(error)) => Some(error.code),
            Err(TransactionError::FocusRestoreFailed { primary, .. } | TransactionError::CursorRestoreFailed { primary, .. }) => {
                primary.as_ref().map(|error| error.code)
            }
        };
        let mut result = result.map_err(DesktopError::from);
        let preset = result.as_mut().err().and_then(|error| error.report.take()).map(|report| *report);
        let code = result.as_ref().err().map(|error| error.code);
        let mut event = audit_event(mutation, code, focus_restored, started.elapsed());
        let object = self.registry.report_mode() == ReportMode::Object;
        if object {
            event.id = Some(ulid::Ulid::generate().to_string());
        }
        (self.safety.audit)(&event);
        self.persist_audit(&event, result.as_ref().err());
        let report = result
            .is_err()
            .then(|| settled_report(preset, primary, mutation.stage.get(), &event));
        let sent = report.as_ref().is_none_or(|report| {
            !matches!(report.disposition, Some(Disposition::NotDelivered { .. }))
        });
        if let (true, true, Some(frame_id)) = (mutation.consume, sent, mutation.frame_id) {
            self.frames.consume(&mutation.target, frame_id);
        }
        match (result, report) {
            (Ok(value), _) => {
                let hit = self.report_extras.take().and_then(|extras| extras.hit);
                let traced = self.options.as_ref().is_some_and(|options| options.trace);
                self.report_extras.set(Some(ReportExtras {
                    route: route(mutation),
                    hit,
                    timings: traced.then(|| mutation.timings.take()),
                }));
                Ok((value, event))
            }
            (Err(error), Some(report)) if object => Err(error.with_report(report)),
            (Err(error), _) => Err(error),
        }
    }

    /// The gate and the transaction proper; `focus_restored` is `None` when
    /// nothing was captured to restore.
    pub(crate) fn transaction<T>(
        &mut self,
        mutation: &Mutation<'_>,
        cancelled: &dyn Fn() -> bool,
        act: impl FnOnce(&mut Self) -> CoreResult<T>,
    ) -> (Result<T, TransactionError>, Option<bool>) {
        // The fail-closed gate (stop path, lock, permissions) answers first:
        // asking the human for a grant is pointless while input cannot run.
        if let Err(refused) = self.gate(mutation) {
            return (Err(TransactionError::Primary(refused)), None);
        }
        if let Err(refused) = self.admit_control(mutation) {
            return (Err(TransactionError::Primary(refused)), None);
        }
        let _watch = match self.admit_intervention(mutation, cancelled) {
            Ok(watch) => watch,
            Err(refused) => return (Err(TransactionError::Primary(refused)), None),
        };
        let whole = locks_whole_transaction(mutation);
        // Dropped after the restore below: the tail expression runs first.
        let _interaction = match whole.then(|| self.take_interaction(mutation, cancelled)).transpose() {
            Ok(held) => held.flatten(),
            Err(refused) => return (Err(TransactionError::Primary(refused)), None),
        };
        let begun = mutation
            .timings
            .time(TimedStage::Capture, || Guard::begin(self, mutation.action, mutation.delivery));
        let guard = match begun {
            Ok(guard) => guard,
            Err(error) => return (Err(TransactionError::Primary(error)), None),
        };
        let mut result = match self.stop_observed(cancelled) {
            Some(stopped) => Err(stopped),
            None => match (!whole).then(|| self.take_interaction(mutation, cancelled)).transpose() {
                Err(refused) => Err(refused),
                Ok(dispatch) => {
                    mutation.stage.set(Stage::Acting);
                    let acted = mutation.timings.time(TimedStage::Dispatch, || guarded(|| act(self)));
                    drop(dispatch);
                    acted
                }
            },
        };
        if result.is_ok() {
            mutation.stage.set(Stage::Acted);
            result = mutation
                .timings
                .time(TimedStage::Verify, || self.after_action(mutation, result));
        }
        if let Err(primary) = &mut result {
            // Recorded on the primary error, never in place of it.
            if let Err(release) = guarded(|| self.backend()?.release_all()) {
                primary.message = format!("{}; releasing held input also failed: {release}", primary.message);
            }
        }
        mutation.timings.time(TimedStage::Restore, || guard.restore(self, result))
    }

    /// Takes the slot's machine-wide lock, giving up on a stop, a
    /// cancellation, or another process holding it past the wait budget.
    fn take_interaction(&self, mutation: &Mutation<'_>, cancelled: &dyn Fn() -> bool) -> CoreResult<Option<Held>> {
        self.safety
            .control_slot
            .interaction()
            .acquire(mutation.fake_backend.get(), &|| self.stop_observed(cancelled))
    }

    /// Waits for the transaction lock, giving up when a stop or a
    /// cancellation is observed first.
    fn admit(&self, cancelled: &dyn Fn() -> bool) -> CoreResult<MutexGuard<'static, ()>> {
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
    fn stop_observed(&self, cancelled: &dyn Fn() -> bool) -> Option<DesktopError> {
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
    fn after_action<T>(&mut self, mutation: &Mutation<'_>, result: CoreResult<T>) -> CoreResult<T> {
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

    fn gate(&mut self, mutation: &Mutation<'_>) -> CoreResult<()> {
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

/// Why an action already under way must stop now, if it must: a stop the
/// user latched, else a stop path that no longer authorizes input (it died,
/// its heartbeat went stale, or it cannot hear the chord). The second never
/// latches a stop, because nobody pressed one.
pub(crate) fn interruption(supervisor: &Supervisor, policy: &StopPolicy) -> Option<DesktopError> {
    let status = supervisor.status();
    if status.suspended {
        return Some(DesktopError::from(GateError::Suspended));
    }
    status.stop_path_unavailable(policy).map(|reason| {
        DesktopError::from(match reason {
            StopPathReason::AccessibilityDenied => GateError::PermissionDenied {
                permission: TccPermission::Accessibility,
            },
            reason => GateError::StopPathUnavailable { reason },
        })
    })
}

/// `prompt-or-granted` (Wayland before the first input) lets the action
/// through: the RemoteDesktop portal asks the user when the first input
/// connects libei, and a refusal there fails the action itself.
fn input_may_proceed(input_permission: &str) -> bool {
    matches!(input_permission, "granted" | "prompt-or-granted")
}

#[cfg(test)]
mod desktop_grant_tests;
#[cfg(test)]
mod grant_tests;
#[cfg(test)]
mod lock_tests;
#[cfg(test)]
mod permission_tests;
#[cfg(test)]
mod stop_tests;
#[cfg(test)]
pub(crate) mod tests;
#[cfg(test)]
mod typing_tests;
#[cfg(test)]
mod remote_typing_tests;
