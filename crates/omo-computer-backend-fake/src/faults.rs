//! The fault FIFO: per call, the next scripted outcome before the fake does anything.

use std::collections::{BTreeMap, VecDeque};

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use crate::method::FakeMethod;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fault {
    /// The call runs as scripted.
    Pass,
    /// The call refuses with this table key before anything is sent.
    Fail {
        code: EngineCode,
        reason: Option<Reason>,
    },
    /// An AX write goes out but its completion is never answered.
    CannotComplete,
    /// The OS refuses to activate the target; nothing is sent.
    RefuseFocus,
    /// The fake panics inside the call, as a crashing backend would.
    Panic,
}

impl Fault {
    /// A failure keyed by `code`'s bare row.
    #[must_use]
    pub const fn fail(code: EngineCode) -> Self {
        Self::Fail { code, reason: None }
    }

    /// The refusal a `Fail` answers with: the scripted code and reason, unchanged.
    #[must_use]
    pub const fn refusal(code: EngineCode, reason: Option<Reason>) -> Refusal {
        match reason {
            Some(reason) => Refusal::new(code, reason.wire()),
            None => Refusal::bare(code),
        }
    }
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
