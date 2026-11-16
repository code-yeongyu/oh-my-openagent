//! The scripted bus: an in-memory tree, a manual clock that every call advances, and a log
//! that counts every round trip so tests can assert zero.

mod build;
mod log;

pub use build::extents;
pub use log::{Counts, FakeHandle};

use log::FakeLog;

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use crate::bus::{AppRef, Bus, BusError, BusEvent, BusResult, NodeFacts, NodeId, OwnerProcess};

#[derive(Debug, Clone, Default)]
struct FakeNode {
    facts: NodeFacts,
    children: Vec<NodeId>,
    parent: Option<NodeId>,
    actions: Vec<String>,
    text: Option<String>,
    attributes: Vec<(String, String)>,
    hung: bool,
    /// `DoAction` takes effect but its reply never comes (the call times out).
    unconfirmed: bool,
}

/// A scripted accessibility bus.
#[derive(Debug)]
pub struct FakeBus {
    apps: Vec<AppRef>,
    nodes: HashMap<NodeId, FakeNode>,
    events: VecDeque<(u64, BusEvent)>,
    clock: u64,
    latency_ms: u64,
    enabled: Option<bool>,
    write_ok: bool,
    owner: Option<OwnerProcess>,
    files: Vec<(PathBuf, String)>,
    reachable: bool,
    serial: u32,
    log: Arc<Mutex<FakeLog>>,
}

impl FakeBus {
    fn count(&mut self, bump: impl FnOnce(&mut Counts)) {
        self.clock += self.latency_ms;
        let mut log = self.log.lock().unwrap_or_else(PoisonError::into_inner);
        log.counts.calls += 1;
        bump(&mut log.counts);
    }

    fn reach(&self) -> BusResult<()> {
        if self.reachable {
            Ok(())
        } else {
            Err(BusError::Unreachable)
        }
    }

    fn live(&mut self, node: &NodeId, slice: Duration) -> BusResult<&FakeNode> {
        self.reach()?;
        if self
            .log
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .gone
            .contains(node)
        {
            return Err(BusError::Failed(format!("{} is gone", node.object_id())));
        }
        let hung = self.nodes.get(node).is_some_and(|found| found.hung);
        if hung {
            self.clock += u64::try_from(slice.as_millis()).unwrap_or(u64::MAX);
            return Err(BusError::Timeout);
        }
        self.nodes
            .get(node)
            .ok_or_else(|| BusError::Failed(format!("{} is gone", node.object_id())))
    }
}

impl Bus for FakeBus {
    fn now_ms(&self) -> u64 {
        self.clock
    }

    fn applications(&mut self, _slice: Duration) -> BusResult<Vec<AppRef>> {
        self.count(|counts| counts.applications += 1);
        self.reach().map(|()| self.apps.clone())
    }

    fn children(&mut self, node: &NodeId, slice: Duration) -> BusResult<Vec<NodeId>> {
        self.count(|counts| counts.children += 1);
        self.live(node, slice).map(|found| found.children.clone())
    }

    fn read(&mut self, node: &NodeId, slice: Duration) -> BusResult<NodeFacts> {
        self.count(|counts| counts.reads += 1);
        let found = self.live(node, slice)?;
        let mut facts = found.facts.clone();
        facts.child_count = u32::try_from(found.children.len()).unwrap_or(u32::MAX);
        facts.interfaces.action = !found.actions.is_empty();
        facts.interfaces.text = found.text.is_some();
        Ok(facts)
    }

    fn text(&mut self, node: &NodeId, slice: Duration) -> BusResult<String> {
        self.count(|_| {});
        Ok(self.live(node, slice)?.text.clone().unwrap_or_default())
    }

    fn parent(&mut self, node: &NodeId, slice: Duration) -> BusResult<Option<NodeId>> {
        self.count(|_| {});
        Ok(self.live(node, slice)?.parent.clone())
    }

    fn action_count(&mut self, node: &NodeId, slice: Duration) -> BusResult<i32> {
        self.count(|_| {});
        let count = self.live(node, slice)?.actions.len();
        Ok(i32::try_from(count).unwrap_or(i32::MAX))
    }

    fn action_name(&mut self, node: &NodeId, index: i32, slice: Duration) -> BusResult<String> {
        self.count(|counts| counts.action_names += 1);
        let actions = &self.live(node, slice)?.actions;
        usize::try_from(index)
            .ok()
            .and_then(|at| actions.get(at).cloned())
            .ok_or_else(|| BusError::Failed(format!("no action {index}")))
    }

    fn do_action(&mut self, node: &NodeId, index: i32, slice: Duration) -> BusResult<bool> {
        self.count(|counts| counts.do_actions += 1);
        let found = self.live(node, slice)?;
        let declared = found.actions.len();
        let opens = found.facts.role == "menu";
        let unconfirmed = found.unconfirmed;
        let mut log = self.log.lock().unwrap_or_else(PoisonError::into_inner);
        log.performed.push((node.clone(), index));
        let done = usize::try_from(index).is_ok_and(|at| at < declared);
        if done && opens && !log.open.contains(node) {
            log.open.push(node.clone());
        }
        if unconfirmed {
            return Err(BusError::Timeout);
        }
        Ok(done)
    }

    fn clear_selection(&mut self, node: &NodeId, slice: Duration) -> BusResult<bool> {
        self.count(|_| {});
        let kids = self.live(node, slice)?.children.clone();
        let mut log = self.log.lock().unwrap_or_else(PoisonError::into_inner);
        log.cleared.push(node.clone());
        log.open.retain(|open| !kids.contains(open));
        Ok(true)
    }

    fn a11y_enabled(&mut self) -> BusResult<bool> {
        self.count(|_| {});
        self.enabled.ok_or(BusError::Unreachable)
    }

    fn set_a11y_enabled(&mut self, enabled: bool) -> BusResult<()> {
        self.count(|counts| counts.status_writes += 1);
        if !self.write_ok {
            return Err(BusError::Failed("IsEnabled write refused".to_owned()));
        }
        self.enabled = Some(enabled);
        let log = Arc::clone(&self.log);
        log.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .enabled_writes
            .push(enabled);
        Ok(())
    }

    fn attributes(&mut self, node: &NodeId, slice: Duration) -> BusResult<Vec<(String, String)>> {
        self.count(|_| {});
        Ok(self.live(node, slice)?.attributes.clone())
    }

    fn register_events(&mut self, kinds: &[&str]) -> BusResult<()> {
        self.count(|_| {});
        self.reach()?;
        let log = Arc::clone(&self.log);
        let mut log = log.lock().unwrap_or_else(PoisonError::into_inner);
        log.registered
            .extend(kinds.iter().map(|kind| (*kind).to_owned()));
        Ok(())
    }

    fn pending_events(&mut self) -> Vec<BusEvent> {
        let mut due = Vec::new();
        while self.events.front().is_some_and(|(at, _)| *at <= self.clock) {
            if let Some((_, event)) = self.events.pop_front() {
                due.push(event);
            }
        }
        due
    }

    fn wait_event(&mut self, timeout: Duration) -> BusResult<Option<BusEvent>> {
        self.count(|_| {});
        self.reach()?;
        let until = self.clock + u64::try_from(timeout.as_millis()).unwrap_or(u64::MAX);
        match self.events.front() {
            Some((at, _)) if *at <= until => {
                self.clock = self.clock.max(*at);
                Ok(self.events.pop_front().map(|(_, event)| event))
            }
            _ => {
                self.clock = until;
                Ok(None)
            }
        }
    }

    fn notification_owner(&mut self) -> BusResult<Option<OwnerProcess>> {
        self.count(|counts| counts.owner_lookups += 1);
        Ok(self.owner.clone())
    }

    fn desktop_files(&mut self) -> Vec<(PathBuf, String)> {
        self.files.clone()
    }
}
