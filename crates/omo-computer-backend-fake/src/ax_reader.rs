//! `AxReader` for the fake: the walk and re-identification reads over the scripted trees.
//! Read `k` of a window's root serves `ax_versions[window][k - 2]` from the second read on (the
//! last version after that), so a scenario can change the tree between two observations. A
//! node's `object` is the native object the fake reports and its handle; a node without one
//! has a handle that dies with its tree version. Reads cost fake-clock time: `NODES_PER_MS`
//! nodes per millisecond, as many per children read as fit in the slice.

use omo_computer_core::ax::{AxHandle, AxReader, Evidence, NativeObject, NodeRead, RootRead, Slice, WindowKey, DEADLINE_MS};
use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::EngineCode;

use crate::ax_tree::{NODES_PER_MS, PAD_ROLE};
use crate::backend::FakeBackend;
use crate::scenario::FakeAxNode;
use crate::state::FakeState;

const INDEXED: u64 = 1 << 63;

/// The tree version a window serves now, with its window index and padding count.
fn current<'a>(state: &'a FakeState, window: &str) -> Option<(u64, u64, &'a FakeAxNode, u32)> {
    let index = state.scenario.ax.keys().position(|id| id == window)?;
    let reads = state.ax_reads.get(window).copied().unwrap_or(1).max(1);
    let versions = state.scenario.ax_versions.get(window);
    let version = versions.map_or(0, |list| (reads - 1).min(list.len()));
    let root = match version {
        0 => state.scenario.ax.get(window)?,
        k => versions?.get(k - 1)?,
    };
    let real = u32::try_from(crate::ax_tree::flatten(root).len()).unwrap_or(u32::MAX);
    let pad = state.scenario.ax_node_count.get(window).map_or(0, |total| total.saturating_sub(real));
    Some((u64::try_from(index).ok()?, u64::try_from(version).ok()?, root, pad))
}

fn handle(window: u64, version: u64, flat: usize, node: Option<&FakeAxNode>) -> AxHandle {
    match node.and_then(|node| node.object) {
        Some(object) => AxHandle(object),
        None => AxHandle(INDEXED | window << 48 | version << 32 | u64::try_from(flat).unwrap_or(0)),
    }
}

fn read(node: &FakeAxNode, handle: AxHandle, pad: u32) -> NodeRead {
    NodeRead {
        handle: Some(handle),
        object: node.object.map(NativeObject),
        role: node.role.clone(),
        native_role: node.native_role.clone(),
        title: node.title.clone(),
        description: node.description.clone(),
        value: node.value.clone(),
        native_id: node.native_id.clone(),
        enabled: node.enabled,
        focused: Some(node.focused),
        actions: node.actions.clone(),
        bounds: node.bounds,
        child_count: u32::try_from(node.children.len()).unwrap_or(u32::MAX).saturating_add(pad),
        evidence: Evidence::of(node.title.is_some(), node.value.is_some(), node.description.is_some()),
        ..NodeRead::default()
    }
}

fn pad_read(handle: AxHandle) -> NodeRead {
    NodeRead { handle: Some(handle), role: PAD_ROLE.to_owned(), ..NodeRead::default() }
}

/// Where `handle` lives now: window, version, flat index (padding past the real nodes).
fn locate(state: &FakeState, wanted: AxHandle) -> Option<(String, usize)> {
    for window in state.scenario.ax.keys() {
        if state.exited.contains(window) {
            continue;
        }
        let (w, version, root, pad) = current(state, window)?;
        let nodes = crate::ax_tree::flatten(root);
        let total = nodes.len() + usize::try_from(pad).unwrap_or(0);
        let found = (0..total).find(|flat| handle(w, version, *flat, nodes.get(*flat).map(|(_, node)| *node)) == wanted);
        if let Some(flat) = found {
            return Some((window.clone(), flat));
        }
    }
    None
}

impl FakeBackend {
    fn node_at(state: &FakeState, window: &str, flat: usize) -> Option<(NodeRead, Vec<NodeRead>)> {
        let (w, version, root, pad) = current(state, window)?;
        let nodes = crate::ax_tree::flatten(root);
        let Some((_, node)) = nodes.get(flat) else {
            return Some((pad_read(handle(w, version, flat, None)), Vec::new()));
        };
        let own_pad = if flat == 0 { pad } else { 0 };
        let mut children: Vec<NodeRead> = node
            .children
            .iter()
            .map(|child| {
                let index = nodes.iter().position(|(_, n)| std::ptr::eq(*n, child)).unwrap_or(usize::MAX);
                read(child, handle(w, version, index, Some(child)), 0)
            })
            .collect();
        let padding = (0..usize::try_from(own_pad).unwrap_or(0)).map(|i| pad_read(handle(w, version, nodes.len() + i, None)));
        children.extend(padding);
        Some((read(node, handle(w, version, flat, Some(node)), own_pad), children))
    }
}

impl AxReader for FakeBackend {
    fn now_ms(&self) -> u64 {
        self.clock.now_ms()
    }

    fn deadline_ms(&self) -> u64 {
        self.lock().scenario.ax_deadline_ms.unwrap_or(DEADLINE_MS)
    }

    fn root(&mut self, window: &str) -> BackendResult<RootRead> {
        let mut state = self.lock();
        let listed = state.windows.iter().find(|w| w.id == window).cloned();
        let Some(listed) = listed.filter(|_| !state.exited.contains(window)) else {
            return Err(Refusal::bare(EngineCode::WindowNotFound));
        };
        *state.ax_reads.entry(window.to_owned()).or_insert(0) += 1;
        let (node, _) = Self::node_at(&state, window, 0).ok_or(Refusal::bare(EngineCode::AxFailed))?;
        let process_start = state.process_start.get(window).copied().unwrap_or(0);
        Ok(RootRead {
            window: WindowKey { id: listed.id.clone(), pid: listed.pid, process_start },
            app: listed.app,
            focused: listed.focused,
            node,
        })
    }

    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        let state = self.lock();
        let Some((window, flat)) = locate(&state, parent) else { return Slice::Read(Vec::new()) };
        let Some((_, children)) = Self::node_at(&state, &window, flat) else { return Slice::Read(Vec::new()) };
        let fit = usize::try_from(slice_ms.saturating_mul(NODES_PER_MS)).unwrap_or(usize::MAX).max(1);
        let batch: Vec<NodeRead> = children.into_iter().skip(usize::try_from(from).unwrap_or(usize::MAX)).take(fit).collect();
        self.clock.advance(u64::try_from(batch.len()).unwrap_or(u64::MAX).div_ceil(NODES_PER_MS));
        Slice::Read(batch)
    }

    fn node(&mut self, handle: AxHandle, _slice_ms: u64) -> Slice<Option<NodeRead>> {
        let state = self.lock();
        let found = locate(&state, handle).and_then(|(window, flat)| Self::node_at(&state, &window, flat));
        Slice::Read(found.map(|(node, _)| node))
    }
}
