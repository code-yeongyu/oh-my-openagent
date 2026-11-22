//! The single choke point of every mutating request: admission to the
//! process-wide transaction lock, the fail-closed
//! [`gate`](senpi_desktop_safety::gate), then one input
//! transaction (focus/cursor capture, the action under `catch_unwind`,
//! `release_all` on failure or suspension, the focus/cursor restore), then
//! exactly one [`AuditEvent`]. Read-only requests never pass here.
//!
//! The machine-wide [`crate::lock::InteractionLock`] is taken after every
//! admission wait and after the actionability wait (nothing is sent while an
//! element is awaited): a foreground transaction holds it from the capture
//! through the restore, background exec only around the dispatch, where the
//! element is checked once more without waiting.
//!
//! A stop or a cancellation observed at admission or just before the action
//! sends no input; suspension always wins over cancellation (gajae
//! `execute_one`).

use std::cell::Cell;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode, ErrorReport, TccPermission};
use senpi_desktop_core::protocol_results::AuditEvent;
use senpi_desktop_core::report::{ActionRoute, Disposition, ReportMode};
use senpi_desktop_core::types::Target;
use senpi_desktop_safety::{
    GateError, MonotonicClock, MutatingAction, StopPathReason, StopPolicy, Supervisor,
};

use crate::audit::audit_event;
use crate::grant::ControlSlot;
use crate::report::{error_report, ReportExtras, Stage};
use crate::restore::TransactionError;
use crate::timings::StageClock;
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
    /// AX reference and optional offered action, waited on before the lock.
    pub(crate) ax_actionability: Option<(&'a str, Option<&'a str>)>,
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
            ax_actionability: None,
            stage: Cell::new(Stage::Admission),
            timings: StageClock::new(),
            fake_backend: Cell::new(false),
        }
    }
}

/// The channel a mutating request's input takes; `None` for a request that
/// sends no input event (`clipboard.write`, a window raise). `ax.typeText`
/// reports `ax` here, for an inserted value; the keys path names its own.
fn route(mutation: &Mutation<'_>) -> Option<ActionRoute> {
    match mutation.action {
        MutatingAction::AxPerform
        | MutatingAction::AxSetValue
        | MutatingAction::AxFocus
        | MutatingAction::AxTypeText
        | MutatingAction::MenuSelect => Some(ActionRoute::Ax),
        // A pointer click posted to the window that owns the element.
        MutatingAction::AxClick => Some(event_route(true, mutation.delivery)),
        MutatingAction::ClipboardWrite | MutatingAction::RaiseWindow => None,
        _ => Some(event_route(
            matches!(Target::parse(&mutation.target), Target::Window(_)),
            mutation.delivery,
        )),
    }
}

/// The channel of input events sent in `delivery` mode, `to_window` when
/// they are addressed to one window.
pub(crate) const fn event_route(to_window: bool, delivery: DeliveryMode) -> ActionRoute {
    match (to_window, delivery) {
        (true, DeliveryMode::Background) => ActionRoute::BackgroundWindow,
        _ => ActionRoute::ForegroundHid,
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
        report.next_call = preset.next_call;
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
                let extras = self.report_extras.take().unwrap_or_default();
                let traced = self.options.as_ref().is_some_and(|options| options.trace);
                self.report_extras.set(Some(ReportExtras {
                    route: extras.route.or_else(|| route(mutation)),
                    hit: extras.hit,
                    timings: traced.then(|| mutation.timings.take()),
                    opened_surfaces: Vec::new(),
                }));
                Ok((value, event))
            }
            (Err(error), Some(report)) if object => Err(error.with_report(report)),
            (Err(error), _) => Err(error),
        }
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

mod admission;
mod transaction;

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
