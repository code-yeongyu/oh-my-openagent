use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::error::{DesktopError, ErrorCode};

use crate::method::FakeMethod;

/// Shared per-method failure queues. Each queued error fails exactly one call
/// of its method, in FIFO order; clones share the queues.
#[derive(Debug, Clone, Default)]
pub struct Faults {
    queues: Arc<Mutex<BTreeMap<FakeMethod, VecDeque<DesktopError>>>>,
}

impl Faults {
    /// Makes the next call of `method` fail with `code`.
    pub fn fail_next(&self, method: FakeMethod, code: ErrorCode) {
        self.queues
            .lock()
            .entry(method)
            .or_default()
            .push_back(DesktopError::new(code, format!("injected {method:?} failure")));
    }

    pub(crate) fn take(&self, method: FakeMethod) -> Option<DesktopError> {
        self.queues.lock().get_mut(&method).and_then(VecDeque::pop_front)
    }
}
