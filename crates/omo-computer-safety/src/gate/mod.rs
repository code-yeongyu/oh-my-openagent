//! `gate()`: the contract's eleven gates in their fixed order. Every stage refuses before any
//! OS call with nothing sent, the first refusal wins, and the gate itself performs no I/O:
//! the targets are resolved by the caller's closure only once gates 1-3 have passed.

mod facts;
mod target;
pub mod verdicts;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{NextCall, UnknownFailure};
use omo_computer_core::params::Point;
use omo_computer_core::results::PermissionState;
use omo_computer_core::session_state::Tristate;

pub use facts::{GateFacts, Identity, PointTarget, Resolution, Tier, VerbKind};
use verdicts::{ConsequentialRefusal, LockRefusal, PermissionRefusal, TakeoverRefusal};

use crate::protected::ProtectedTable;
use crate::self_set::SelfSet;
use crate::stop_path::StopPathKind;

/// The contract's gates (1)-(11), in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Gate {
    Latch = 1,
    StopPath = 2,
    Lock = 3,
    Target = 4,
    OsPermission = 5,
    Consent = 6,
    Route = 7,
    Lease = 8,
    Consequential = 9,
    Frame = 10,
    Takeover = 11,
}

impl Gate {
    /// Every gate, in the order they run.
    pub const ORDER: [Self; 11] = [
        Self::Latch,
        Self::StopPath,
        Self::Lock,
        Self::Target,
        Self::OsPermission,
        Self::Consent,
        Self::Route,
        Self::Lease,
        Self::Consequential,
        Self::Frame,
        Self::Takeover,
    ];

    #[must_use]
    pub const fn number(self) -> u8 {
        self as u8
    }

    /// Every refusal the gate can emit.
    #[must_use]
    pub fn refusals(self) -> Vec<Refusal> {
        use verdicts::{ConsentRefusal, FrameRefusal, LeaseRefusal, RouteRefusal, TargetRefusal};
        fn all<T: Copy>(items: &[T], refusal: fn(T) -> Refusal) -> Vec<Refusal> {
            items.iter().copied().map(refusal).collect()
        }
        match self {
            Self::Latch => all(
                &crate::latch::SuspendReason::ALL,
                crate::latch::SuspendReason::refusal,
            ),
            Self::StopPath => all(
                &crate::stop_path::StopPathFailure::ALL,
                crate::stop_path::StopPathFailure::refusal,
            ),
            Self::Lock => all(&LockRefusal::ALL, LockRefusal::refusal),
            Self::Target => all(&TargetRefusal::ALL, TargetRefusal::refusal),
            Self::OsPermission => all(&PermissionRefusal::ALL, PermissionRefusal::refusal),
            Self::Consent => all(&ConsentRefusal::ALL, ConsentRefusal::refusal),
            Self::Route => all(&RouteRefusal::ALL, RouteRefusal::refusal),
            Self::Lease => all(&LeaseRefusal::ALL, LeaseRefusal::refusal),
            Self::Consequential => all(&ConsequentialRefusal::ALL, ConsequentialRefusal::refusal),
            Self::Frame => all(&FrameRefusal::ALL, FrameRefusal::refusal),
            Self::Takeover => all(&TakeoverRefusal::ALL, TakeoverRefusal::refusal),
        }
    }
}

/// The refused point of a multi-point request and the refusing stage's own refusal.
#[derive(Debug, Clone, PartialEq)]
pub struct DragPoint {
    pub point: Option<Point>,
    pub inner: Refusal,
}

/// A refusal of the gate: nothing was sent.
#[derive(Debug, Clone, PartialEq)]
pub struct GateRefusal {
    pub gate: Gate,
    pub refusal: Refusal,
    pub drag: Option<DragPoint>,
}

impl GateRefusal {
    #[must_use]
    pub const fn new(gate: Gate, refusal: Refusal) -> Self {
        Self {
            gate,
            refusal,
            drag: None,
        }
    }

    /// Always true: every gate refuses before the first OS call.
    #[must_use]
    pub const fn nothing_sent(&self) -> bool {
        true
    }

    /// The row's `nextCall`.
    ///
    /// # Errors
    /// The pair has no row (a defect the row test rules out).
    pub fn next_call(&self) -> Result<NextCall, UnknownFailure> {
        self.refusal.row().map(|row| row.next_call)
    }
}

/// An admitted call, and the stop path that admitted an exec.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Admitted {
    pub stop_path: Option<StopPathKind>,
}

/// The tables the Target, Scope and Consequential stages read.
#[derive(Clone, Copy)]
pub struct Tables<'a> {
    pub self_set: &'a SelfSet,
    pub protected: &'a ProtectedTable,
    /// `consent.apps.allow`: denied apps the user allowed.
    pub allowed_apps: &'a [String],
}

impl Tables<'_> {
    fn is_denied_app(&self, identity: &Identity) -> bool {
        self.protected.is_denied_app(identity)
            && !self
                .allowed_apps
                .iter()
                .any(|app| app.eq_ignore_ascii_case(&identity.app_key))
    }
}

/// Runs the gates in order; the first refusal wins.
///
/// # Errors
/// The refusing gate and its refusal, with nothing sent.
pub fn gate(
    facts: &GateFacts,
    tables: &Tables<'_>,
    targets: impl FnOnce() -> Vec<PointTarget>,
) -> Result<Admitted, GateRefusal> {
    // RED: the gate order is not built yet.
    let _ = (facts, tables, targets);
    Ok(Admitted { stop_path: None })
}

/// Gates 7-11 of an exec call.
fn exec_tail(facts: &GateFacts, tables: &Tables<'_>) -> Result<(), GateRefusal> {
    if let Some(route) = facts.route {
        return Err(GateRefusal::new(Gate::Route, route.refusal()));
    }
    if let Some(lease) = facts.lease {
        return Err(GateRefusal::new(Gate::Lease, lease.refusal()));
    }
    let dangerous = facts
        .chord
        .as_deref()
        .is_some_and(|chord| tables.protected.is_dangerous_chord(chord));
    if dangerous && !facts.force {
        return Err(GateRefusal::new(
            Gate::Consequential,
            ConsequentialRefusal::DangerousChord.refusal(),
        ));
    }
    if let Some(consequential) = facts.consequential {
        return Err(GateRefusal::new(
            Gate::Consequential,
            consequential.refusal(),
        ));
    }
    if let Some(frame) = facts.frame {
        return Err(GateRefusal::new(Gate::Frame, frame.refusal()));
    }
    if facts.user_active_in_target {
        return Err(GateRefusal::new(
            Gate::Takeover,
            TakeoverRefusal::UserActiveInTarget.refusal(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
