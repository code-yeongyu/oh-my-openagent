use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::error::{DesktopError, ErrorCode};

use crate::method::FakeMethod;

/// Shared per-method failure queues. Each queued error fails exactly one call
/// of its method, in FIFO order; clones share the queues.
#[derive(Debug, Clone, Default)]
pub struct Faults {
    queues: Arc<Mutex<BTreeMap<FakeMethod, VecDeque<Fault>>>>,
}

enum Fault {
    Pass,
    Fail(DesktopError),
    Panic,
    Hook(Box<dyn FnOnce() + Send>),
}

impl std::fmt::Debug for Fault {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Pass => "Pass",
            Self::Fail(_) => "Fail",
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
        let fault = self.queues.lock().get_mut(&method).and_then(VecDeque::pop_front);
        // Run outside the fault-queue lock so hooks can drive the real supervisor.
        match fault {
            Some(Fault::Fail(error)) => Some(error),
            Some(Fault::Panic) => panic!("injected {method:?} panic"),
            Some(Fault::Hook(hook)) => { hook(); None }
            Some(Fault::Pass) | None => None,
        }
    }
}
