//! The fault FIFO: per call, the next scripted outcome before the fake does anything.

use std::collections::{BTreeMap, VecDeque};

use omo_computer_core::backend::{Refusal, RefusalCode};

use crate::method::FakeMethod;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fault {
    /// The call runs as scripted.
    Pass,
    /// The call refuses with this engine code before anything is sent.
    Fail {
        code: String,
        reason: Option<String>,
    },
    /// An AX write goes out but its completion is never answered.
    CannotComplete,
    /// The OS refuses to move focus; nothing is sent.
    RefuseFocus,
    /// The fake panics inside the call, as a crashing backend would.
    Panic,
}

impl Fault {
    #[must_use]
    pub fn fail(code: &str) -> Self {
        Self::Fail {
            code: code.to_owned(),
            reason: None,
        }
    }
}

/// Reason tokens a scripted failure may carry through the trait's static reason.
const KNOWN_REASONS: &[&str] = &[
    "minimized",
    "offscreen",
    "target_gone",
    "window_not_found",
    "permission_denied",
    "focus_refused",
    "deaf",
];

/// Where a scripted reason is not a known token.
pub const SCRIPTED_REASON: &str = "scripted_fault";

// owed to row 13 merge: the total (engineCode, data.reason) -> COMPUTER_* table. Until then a
// scripted engine code outside the five row-12 refusal codes keeps the call's natural code,
// and the scripted code itself is read back through `FakeBackend::last_fault`.
fn natural_code(method: FakeMethod) -> RefusalCode {
    if method == FakeMethod::Capture {
        RefusalCode::CaptureUnavailable
    } else if matches!(method, FakeMethod::AxSnapshot | FakeMethod::AxResolve)
        || method.is_ax_write()
    {
        RefusalCode::AxUnavailable
    } else {
        RefusalCode::Unavailable
    }
}

/// The trait refusal a scripted failure of `method` answers with.
#[must_use]
pub fn refusal(method: FakeMethod, code: &str, reason: Option<&str>) -> Refusal {
    let codes = [
        RefusalCode::Unavailable,
        RefusalCode::CaptureUnavailable,
        RefusalCode::AxUnavailable,
        RefusalCode::StopPathUnavailable,
        RefusalCode::PresenceUnavailable,
    ];
    let code = codes
        .into_iter()
        .find(|candidate| candidate.engine_code() == code)
        .unwrap_or_else(|| natural_code(method));
    let reason = reason
        .and_then(|reason| KNOWN_REASONS.iter().copied().find(|known| *known == reason))
        .unwrap_or(SCRIPTED_REASON);
    Refusal::new(code, reason)
}

#[derive(Debug, Clone, Default)]
pub struct FaultQueue {
    queues: BTreeMap<FakeMethod, VecDeque<Fault>>,
}

impl FaultQueue {
    pub fn push(&mut self, method: FakeMethod, fault: Fault) {
        self.queues.entry(method).or_default().push_back(fault);
    }

    /// The next fault of `method`, or [`Fault::Pass`] when none is queued.
    pub fn pop(&mut self, method: FakeMethod) -> Fault {
        self.queues
            .get_mut(&method)
            .and_then(VecDeque::pop_front)
            .unwrap_or(Fault::Pass)
    }
}
