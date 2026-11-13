use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use crate::method::{AxWrite, FakeMethod};

/// Shared per-method failure queues. Each queued error fails exactly one call
/// of its method, in FIFO order; clones share the queues.
#[derive(Debug, Clone, Default)]
pub struct Faults {
    queues: Arc<Mutex<BTreeMap<FakeMethod, VecDeque<Fault>>>>,
    calls: Arc<Mutex<BTreeMap<FakeMethod, usize>>>,
}

enum Fault {
    Pass,
    Fail(DesktopError),
    CannotComplete,
    /// The element never takes focus (`ax.typeText` keys path): nothing typed.
    RefuseFocus,
    Panic,
    Hook(Box<dyn FnOnce() + Send>),
}

impl std::fmt::Debug for Fault {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Pass => "Pass",
            Self::Fail(_) => "Fail",
            Self::CannotComplete => "CannotComplete",
            Self::RefuseFocus => "RefuseFocus",
            Self::Panic => "Panic",
            Self::Hook(_) => "Hook",
        })
    }
}

impl Faults {
    /// Makes the next call of `method` fail with `code`.
    pub fn fail_next(&self, method: FakeMethod, code: ErrorCode) {
        self.fail_next_with(method, DesktopError::new(code, format!("injected {method:?} failure")));
    }

    /// Queues one exact error for the next call of `method`, so a scenario
    /// can pin structured data (e.g. `CaptureUnavailable`/`minimized`).
    pub fn fail_next_with(&self, method: FakeMethod, error: DesktopError) {
        self.queues.lock().entry(method).or_default().push_back(Fault::Fail(error));
    }

    /// Leaves the next `write` unanswered: its side effect lands, then the
    /// call reports `AxUnconfirmed`.
    pub fn cannot_complete_next(&self, write: AxWrite) {
        self.queues.lock().entry(write.method()).or_default().push_back(Fault::CannotComplete);
    }

    /// Makes the next `ax.typeText` keys path find an element that never
    /// takes focus, so nothing is typed and the call reports where focus is.
    pub fn refuse_focus_next(&self) {
        self.queues.lock().entry(FakeMethod::AxTypeText).or_default().push_back(Fault::RefuseFocus);
    }

    /// Panic after `calls` preceding calls have returned normally.
    pub fn panic_after(&self, method: FakeMethod, calls: usize) {
        let mut queues = self.queues.lock();
        let queue = queues.entry(method).or_default();
        queue.extend((0..calls).map(|_| Fault::Pass));
        queue.push_back(Fault::Panic);
    }

    /// Run once inside the method, after its side effect was recorded.
    pub fn on_next(&self, method: FakeMethod, hook: impl FnOnce() + Send + 'static) {
        self.queues.lock().entry(method).or_default().push_back(Fault::Hook(Box::new(hook)));
    }

    pub(crate) fn take(&self, method: FakeMethod) -> Option<DesktopError> {
        self.next(method).err()
    }

    /// Whether a `RefuseFocus` fault is queued for `ax.typeText`, consuming it.
    pub(crate) fn take_refused_focus(&self) -> bool {
        let mut queues = self.queues.lock();
        let Some(queue) = queues.get_mut(&FakeMethod::AxTypeText) else {
            return false;
        };
        if matches!(queue.front(), Some(Fault::RefuseFocus)) {
            queue.pop_front();
            true
        } else {
            false
        }
    }

    /// [`Self::take`] for an AX write, which a `CannotComplete` fault lets
    /// run unanswered.
    pub(crate) fn take_write(&self, write: AxWrite) -> CoreResult<Reply> {
        self.next(write.method())
    }

    /// How many times the backend began `method` so far.
    pub fn calls(&self, method: FakeMethod) -> usize {
        self.calls.lock().get(&method).copied().unwrap_or(0)
    }

    fn next(&self, method: FakeMethod) -> CoreResult<Reply> {
        *self.calls.lock().entry(method).or_insert(0) += 1;
        let fault = {
            let mut queues = self.queues.lock();
            let queue = queues.get_mut(&method);
            // A refused focus stays queued for `take_refused_focus`, which the
            // keys path reads after this entry check.
            match queue.as_ref().and_then(|queue| queue.front()) {
                Some(Fault::RefuseFocus) => None,
                _ => queue.and_then(VecDeque::pop_front),
            }
        };
        // Run outside the fault-queue lock so hooks can drive the real supervisor.
        match fault {
            Some(Fault::Fail(error)) => Err(error),
            Some(Fault::CannotComplete) => Ok(Reply::Unanswered),
            Some(Fault::RefuseFocus) => unreachable!("a refused focus is never popped here"),
            Some(Fault::Panic) => panic!("injected {method:?} panic"),
            Some(Fault::Hook(hook)) => {
                hook();
                Ok(Reply::Answered)
            }
            Some(Fault::Pass) | None => Ok(Reply::Answered),
        }
    }
}

/// Whether the fake app answered an AX write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reply {
    Answered,
    Unanswered,
}

impl Reply {
    /// The call's result once the write has landed.
    pub(crate) fn confirm(self, request: &str) -> CoreResult<()> {
        match self {
            Self::Answered => Ok(()),
            Self::Unanswered => Err(DesktopError::ax_unconfirmed(format!(
                "{request} was requested, but its outcome could not be confirmed: the fake app did \
                 not reply (injected ax_cannot_complete). It may already have taken effect: observe \
                 the window before retrying"
            ))),
        }
    }
}
