//! Scripting the fake: applications, nodes, events, the a11y flag, the notification owner and
//! the desktop entries.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use super::{FakeBus, FakeHandle, FakeLog, FakeNode};
use crate::bus::{AppRef, BusEvent, Extents, NodeFacts, NodeId, OwnerProcess, States};

const APP_ROOT: &str = "/org/a11y/atspi/accessible/root";

impl FakeBus {
    /// A reachable bus with the flag already on; opening it is its one connection.
    #[must_use]
    pub fn new() -> (Self, FakeHandle) {
        let log = Arc::new(Mutex::new(FakeLog::default()));
        log.lock().unwrap_or_else(PoisonError::into_inner).counts.connects = 1;
        let bus = Self {
            apps: Vec::new(),
            nodes: HashMap::new(),
            events: VecDeque::new(),
            clock: 0,
            latency_ms: 0,
            enabled: Some(true),
            write_ok: true,
            owner: None,
            files: Vec::new(),
            reachable: true,
            serial: 0,
            log: Arc::clone(&log),
        };
        (bus, FakeHandle(log))
    }

    /// A bus whose every call answers `Unreachable`.
    #[must_use]
    pub fn unreachable() -> (Self, FakeHandle) {
        let (mut bus, handle) = Self::new();
        bus.reachable = false;
        (bus, handle)
    }

    /// Registers an application on its own connection.
    pub fn app(&mut self, pid: u32, name: &str) -> NodeId {
        self.serial += 1;
        let root = NodeId::new(format!(":1.{}", self.serial), APP_ROOT);
        let facts = NodeFacts {
            role: "application".to_owned(),
            name: Some(name.to_owned()),
            ..NodeFacts::default()
        };
        self.nodes.insert(root.clone(), FakeNode { facts, ..FakeNode::default() });
        self.apps.push(AppRef {
            node: root.clone(),
            pid: Some(pid),
            name: name.to_owned(),
        });
        root
    }

    /// Adds a child of `parent` on `parent`'s connection.
    pub fn node(&mut self, parent: &NodeId, role: &str, name: &str) -> NodeId {
        self.serial += 1;
        let id = NodeId::new(parent.bus.clone(), format!("/org/a11y/atspi/accessible/{}", self.serial));
        let facts = NodeFacts {
            role: role.to_owned(),
            name: (!name.is_empty()).then(|| name.to_owned()),
            states: States { enabled: true, ..States::default() },
            ..NodeFacts::default()
        };
        let node = FakeNode { facts, parent: Some(parent.clone()), ..FakeNode::default() };
        self.nodes.insert(id.clone(), node);
        if let Some(found) = self.nodes.get_mut(parent) {
            found.children.push(id.clone());
        }
        id
    }

    fn at(&mut self, node: &NodeId) -> &mut FakeNode {
        self.nodes.entry(node.clone()).or_default()
    }

    pub fn set_actions(&mut self, node: &NodeId, actions: &[&str]) {
        self.at(node).actions = actions.iter().map(|name| (*name).to_owned()).collect();
    }

    pub fn set_states(&mut self, node: &NodeId, states: States) {
        self.at(node).facts.states = states;
    }

    pub fn set_extents(&mut self, node: &NodeId, extents: Extents) {
        let found = self.at(node);
        found.facts.extents = Some(extents);
        found.facts.interfaces.component = true;
    }

    pub fn set_text(&mut self, node: &NodeId, text: &str) {
        self.at(node).text = Some(text.to_owned());
    }

    pub fn set_accessible_id(&mut self, node: &NodeId, id: &str) {
        self.at(node).facts.accessible_id = Some(id.to_owned());
    }

    /// Every read of `node` times out.
    pub fn set_hung(&mut self, node: &NodeId) {
        self.at(node).hung = true;
    }

    /// Detaches `node` from its parent: the object is gone.
    pub fn remove(&mut self, node: &NodeId) {
        if let Some(parent) = self.nodes.remove(node).and_then(|gone| gone.parent) {
            self.at(&parent).children.retain(|child| child != node);
        }
    }

    /// Queues an event the bus delivers once the clock reaches `at_ms`.
    pub fn push_event(&mut self, at_ms: u64, kind: &str, sender: &NodeId) {
        let event = BusEvent {
            kind: kind.to_owned(),
            sender: sender.clone(),
            detail: 1,
        };
        self.events.push_back((at_ms, event));
    }

    /// `None` makes `IsEnabled` unreadable; `write_ok:false` refuses the write.
    pub fn set_a11y(&mut self, enabled: Option<bool>, write_ok: bool) {
        self.enabled = enabled;
        self.write_ok = write_ok;
    }

    pub fn set_owner(&mut self, pid: u32, name: &str) {
        self.owner = Some(OwnerProcess { pid, name: name.to_owned() });
    }

    pub fn add_desktop_file(&mut self, path: &str, contents: &str) {
        self.files.push((PathBuf::from(path), contents.to_owned()));
    }

    /// Milliseconds every call advances the clock.
    pub fn set_latency(&mut self, latency_ms: u64) {
        self.latency_ms = latency_ms;
    }
}

/// Extents shorthand for fixtures.
#[must_use]
pub const fn extents(x: i32, y: i32, width: i32, height: i32) -> Extents {
    Extents { x, y, width, height }
}
