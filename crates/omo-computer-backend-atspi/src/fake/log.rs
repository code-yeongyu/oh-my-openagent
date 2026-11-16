//! The fake's log: every round trip counted, every action and flag write recorded, the menus
//! a press left open, and the test's handle on it after the bus moved into a backend.

use std::sync::{Arc, Mutex, PoisonError};

use crate::bus::NodeId;

/// Calls per kind; `calls` counts every bus round trip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub calls: u32,
    pub connects: u32,
    pub applications: u32,
    pub children: u32,
    pub reads: u32,
    pub action_names: u32,
    pub do_actions: u32,
    pub owner_lookups: u32,
    pub status_writes: u32,
}

#[derive(Debug, Default)]
pub(super) struct FakeLog {
    pub(super) counts: Counts,
    pub(super) performed: Vec<(NodeId, i32)>,
    pub(super) registered: Vec<String>,
    pub(super) enabled_writes: Vec<bool>,
    pub(super) gone: Vec<NodeId>,
    /// Menus a press opened that no `ClearSelection` on their container closed yet.
    pub(super) open: Vec<NodeId>,
    /// Every `ClearSelection` target, in call order.
    pub(super) cleared: Vec<NodeId>,
}

/// The test's view of the log after the bus moved into a backend.
#[derive(Debug, Clone)]
pub struct FakeHandle(pub(super) Arc<Mutex<FakeLog>>);

impl FakeHandle {
    fn with<T>(&self, read: impl FnOnce(&FakeLog) -> T) -> T {
        read(&self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }

    #[must_use]
    pub fn counts(&self) -> Counts {
        self.with(|log| log.counts)
    }

    /// Every `DoAction` as `(node, index)`.
    #[must_use]
    pub fn performed(&self) -> Vec<(NodeId, i32)> {
        self.with(|log| log.performed.clone())
    }

    #[must_use]
    pub fn registered(&self) -> Vec<String> {
        self.with(|log| log.registered.clone())
    }

    /// The object leaves the bus after the bus moved into a backend.
    pub fn kill(&self, node: &NodeId) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .gone
            .push(node.clone());
    }

    /// The menus still open: pressed and not closed by their container's `ClearSelection`.
    #[must_use]
    pub fn open_menus(&self) -> Vec<NodeId> {
        self.with(|log| log.open.clone())
    }

    #[must_use]
    pub fn cleared(&self) -> Vec<NodeId> {
        self.with(|log| log.cleared.clone())
    }

    #[must_use]
    pub fn enabled_writes(&self) -> Vec<bool> {
        self.with(|log| log.enabled_writes.clone())
    }
}
