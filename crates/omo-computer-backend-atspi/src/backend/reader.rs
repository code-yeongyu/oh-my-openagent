//! `AxReader` over the bus: the walk the core runs and the re-identification reads, each read
//! bounded by its slice of the observe deadline. Handles name bus objects for the session.

use std::collections::HashMap;
use std::time::Duration;

use omo_computer_core::ax::{
    AxHandle, AxReader, Evidence, NativeObject, NodeRead, RootRead, Seen, Slice, WindowKey,
};
use omo_computer_core::backend::BackendResult;
use omo_computer_core::listing::Rect;

use super::AtspiBackend;
use crate::bus::{read_slice, Bus, BusError, NodeFacts, NodeId};
use crate::roles::{outline_role, reads_text};
use crate::secure::is_secure;

/// The bus objects the reader handed out, by handle.
#[derive(Debug, Default)]
pub(crate) struct Handles {
    nodes: Vec<NodeId>,
    index: HashMap<NodeId, u64>,
}

impl Handles {
    pub fn of(&mut self, node: &NodeId) -> AxHandle {
        if let Some(found) = self.index.get(node) {
            return AxHandle(*found);
        }
        let handle = u64::try_from(self.nodes.len()).unwrap_or(u64::MAX);
        self.nodes.push(node.clone());
        self.index.insert(node.clone(), handle);
        AxHandle(handle)
    }

    pub fn node(&self, handle: AxHandle) -> Option<&NodeId> {
        usize::try_from(handle.0)
            .ok()
            .and_then(|at| self.nodes.get(at))
    }
}

fn rect(facts: &NodeFacts) -> Option<Rect> {
    facts.extents.map(|e| Rect {
        x: f64::from(e.x),
        y: f64::from(e.y),
        width: f64::from(e.width),
        height: f64::from(e.height),
    })
}

/// One read of `node` as the walk consumes it; the value is read only where the role keeps
/// it in the Text interface, and never from a secure element.
pub(crate) fn node_read<B: Bus>(
    bus: &mut B,
    handle: AxHandle,
    facts: &NodeFacts,
    slice: Duration,
    node: &NodeId,
) -> NodeRead {
    let secure = is_secure(facts);
    let value = (facts.interfaces.text && reads_text(&facts.role) && !secure)
        .then(|| bus.text(node, slice).ok())
        .flatten();
    let states = facts.states;
    NodeRead {
        handle: Some(handle),
        object: Some(NativeObject(handle.0)),
        role: outline_role(&facts.role),
        native_role: Some(facts.role.clone()),
        title: facts.name.clone().filter(|name| !name.is_empty()),
        description: facts.description.clone().filter(|text| !text.is_empty()),
        evidence: Evidence::of(
            facts.name.as_deref().is_some_and(|name| !name.is_empty()),
            value.is_some(),
            facts
                .description
                .as_deref()
                .is_some_and(|text| !text.is_empty()),
        ),
        value,
        native_id: facts.accessible_id.clone().filter(|id| !id.is_empty()),
        enabled: Some(states.enabled),
        focused: Some(states.focused),
        selected: Some(states.selected),
        expanded: Some(states.expanded),
        checked: Some(states.checked),
        secure,
        actions: Vec::new(),
        bounds: rect(facts),
        child_count: facts.child_count,
    }
}

/// An element that did not answer inside its slice: its label and value are unknown.
fn unread(handle: AxHandle) -> NodeRead {
    let unknown = Evidence {
        title: Seen::Unknown,
        value: Seen::Unknown,
        description: Seen::Unknown,
    };
    NodeRead {
        handle: Some(handle),
        object: Some(NativeObject(handle.0)),
        role: "unknown".to_owned(),
        evidence: unknown,
        ..NodeRead::default()
    }
}

impl<B: Bus> AxReader for AtspiBackend<B> {
    fn now_ms(&self) -> u64 {
        self.bus.as_ref().map_or(0, Bus::now_ms)
    }

    fn root(&mut self, window: &str) -> BackendResult<RootRead> {
        let frame = self.frame_for(window).map_err(|refused| refused.refusal)?;
        let bus = self.bus.as_mut().ok_or_else(super::ax_unavailable)?;
        let facts = bus
            .read(&frame.node, read_slice(super::observe::ROOT_SLICE_MS))
            .map_err(|_| super::ax_unavailable())?;
        let handle = self.refs.handles.of(&frame.node);
        let node = node_read(
            bus,
            handle,
            &facts,
            read_slice(super::observe::ROOT_SLICE_MS),
            &frame.node,
        );
        Ok(RootRead {
            window: WindowKey {
                id: frame.window.clone(),
                pid: frame.pid,
                process_start: process_start(frame.pid),
            },
            app: frame.app.clone(),
            focused: facts.states.active || facts.states.focused,
            node,
        })
    }

    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        let (Some(bus), Some(node)) = (self.bus.as_mut(), self.refs.handles.node(parent).cloned())
        else {
            return Slice::Read(Vec::new());
        };
        let start = bus.now_ms();
        let kids = match bus.children(&node, read_slice(slice_ms)) {
            Ok(kids) => kids,
            Err(BusError::Timeout) => return Slice::Hung,
            Err(_) => return Slice::Read(Vec::new()),
        };
        let mut batch = Vec::new();
        for kid in kids
            .iter()
            .skip(usize::try_from(from).unwrap_or(usize::MAX))
        {
            let remaining = (start + slice_ms).saturating_sub(bus.now_ms());
            if remaining == 0 && !batch.is_empty() {
                break;
            }
            let handle = self.refs.handles.of(kid);
            let slice = read_slice(remaining.max(1));
            batch.push(match bus.read(kid, slice) {
                Ok(facts) => {
                    if facts.interfaces.action {
                        self.refs.actionable.insert(kid.clone());
                    }
                    node_read(bus, handle, &facts, slice, kid)
                }
                Err(_) => unread(handle),
            });
        }
        if batch.is_empty() && from < u32::try_from(kids.len()).unwrap_or(u32::MAX) {
            return Slice::Hung;
        }
        Slice::Read(batch)
    }

    fn node(&mut self, handle: AxHandle, slice_ms: u64) -> Slice<Option<NodeRead>> {
        let (Some(bus), Some(node)) = (self.bus.as_mut(), self.refs.handles.node(handle).cloned())
        else {
            return Slice::Read(None);
        };
        let slice = read_slice(slice_ms);
        match bus.read(&node, slice) {
            Ok(facts) => Slice::Read(Some(node_read(bus, handle, &facts, slice, &node))),
            Err(BusError::Timeout) => Slice::Hung,
            Err(_) => Slice::Read(None),
        }
    }
}

/// The start time of `pid` in clock ticks since boot (`/proc/<pid>/stat` field 22); 0 when
/// unreadable. A different start is a different process with a reused pid.
#[must_use]
pub fn process_start(pid: u32) -> u64 {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| {
            let rest = stat.rsplit_once(')')?.1;
            rest.split_whitespace().nth(19)?.parse().ok()
        })
        .unwrap_or(0)
}
