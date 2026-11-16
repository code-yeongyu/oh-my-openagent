//! `MacAx`: the macOS accessibility backend over one AX server. It implements the core
//! [`AxReader`] (one attribute IPC per node, deadline-sliced children) for the walk.

use std::collections::BTreeSet;

use omo_computer_core::ax::{
    AxHandle, AxReader, NodeRead, RootRead, Slice, WindowKey, DEADLINE_MS,
};
use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::{EngineCode, Reason};

use super::attributes::node;
use super::chromium;
use super::handles::{Handles, Retained};
use super::notifications::Surface;
use super::seam::{AxServer, Element, WindowOwner};

/// Children one children IPC asks for.
pub const CHILD_BATCH: u32 = 64;

/// The macOS AX backend.
pub struct MacAx<S> {
    pub(crate) server: S,
    pub(crate) handles: Handles,
    pub(crate) surface: Surface,
    observed: BTreeSet<u32>,
}

impl<S: AxServer> MacAx<S> {
    pub fn new(server: S) -> Self {
        Self {
            server,
            handles: Handles::default(),
            surface: Surface::default(),
            observed: BTreeSet::new(),
        }
    }

    pub const fn server(&self) -> &S {
        &self.server
    }

    pub const fn server_mut(&mut self) -> &mut S {
        &mut self.server
    }

    /// Registers the app's one observer (the eleven notifications) the first time.
    pub(crate) fn ensure_observed(&mut self, pid: u32) {
        if self.observed.insert(pid) {
            self.server.observe(pid);
        }
    }

    /// The owner and the `AXWindow` element of window `id`.
    pub(crate) fn window(&mut self, id: &str) -> BackendResult<(u32, WindowOwner, Element)> {
        let not_found = Refusal::bare(EngineCode::WindowNotFound);
        let number: u32 = id.parse().map_err(|_| not_found.clone())?;
        let owner = self.server.window_owner(number).ok_or(not_found)?;
        let element = self.server.window(owner.pid, number).ok_or(Refusal::new(
            EngineCode::AxUnsupported,
            Reason::SnapshotUnsupported,
        ))?;
        Ok((number, owner, element))
    }

    pub(crate) fn retain(&mut self, element: Element, window: u32, owner: (u32, u64)) -> AxHandle {
        let token = self.server.remote_token().and_then(|t| t.token(element));
        self.handles.retain(Retained {
            element,
            window,
            pid: owner.0,
            process_start: owner.1,
            token,
        })
    }

    fn read_node(
        &mut self,
        element: Element,
        window: u32,
        owner: (u32, u64),
        slice_ms: u64,
    ) -> Slice<Option<NodeRead>> {
        match self.server.read(element, slice_ms) {
            Slice::Hung => Slice::Hung,
            Slice::Read(None) => Slice::Read(None),
            Slice::Read(Some(attributes)) => {
                let handle = self.retain(element, window, owner);
                Slice::Read(Some(node(handle, attributes)))
            }
        }
    }
}

impl<S: AxServer> AxReader for MacAx<S> {
    fn now_ms(&self) -> u64 {
        self.server.now_ms()
    }

    fn root(&mut self, window: &str) -> BackendResult<RootRead> {
        let (number, owner, element) = self.window(window)?;
        self.ensure_observed(owner.pid);
        let deadline = self.server.now_ms().saturating_add(DEADLINE_MS);
        let mut attributes = match self.server.read(element, omo_computer_core::ax::SLICE_MS) {
            Slice::Read(Some(attributes)) => attributes,
            Slice::Read(None) => return Err(Refusal::bare(EngineCode::WindowNotFound)),
            Slice::Hung => return Err(Refusal::bare(EngineCode::AxFailed)),
        };
        if attributes.child_count == 0 {
            if let Some(woken) = chromium::wake(&mut self.server, &owner, element, deadline) {
                attributes = woken;
            }
        }
        let handle = self.retain(element, number, (owner.pid, owner.process_start));
        Ok(RootRead {
            window: WindowKey {
                id: window.to_owned(),
                pid: owner.pid,
                process_start: owner.process_start,
            },
            app: owner.app,
            focused: attributes.focused.unwrap_or(false),
            node: node(handle, attributes),
        })
    }

    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        let Some(retained) = self.handles.get(parent).cloned() else {
            return Slice::Read(Vec::new());
        };
        let start = self.server.now_ms();
        let elements = match self
            .server
            .children(retained.element, from, CHILD_BATCH, slice_ms)
        {
            Slice::Hung => return Slice::Hung,
            Slice::Read(elements) => elements,
        };
        let owner = (retained.pid, retained.process_start);
        let mut out = Vec::with_capacity(elements.len());
        for element in elements {
            let left = slice_ms.saturating_sub(self.server.now_ms().saturating_sub(start));
            if left == 0 {
                break;
            }
            match self.read_node(element, retained.window, owner, left) {
                Slice::Read(Some(read)) => out.push(read),
                // A gone child or a hung control ends the batch; the walk records the cut.
                Slice::Read(None) => break,
                Slice::Hung if out.is_empty() => return Slice::Hung,
                Slice::Hung => break,
            }
        }
        Slice::Read(out)
    }

    fn node(&mut self, handle: AxHandle, slice_ms: u64) -> Slice<Option<NodeRead>> {
        let Some(retained) = self.handles.get(handle).cloned() else {
            return Slice::Read(None);
        };
        let resolved = match (retained.token.as_deref(), self.server.remote_token()) {
            (Some(token), Some(resolver)) => resolver.resolve(token),
            _ => None,
        };
        let element = resolved.unwrap_or(retained.element);
        match self.server.read(element, slice_ms) {
            Slice::Hung => Slice::Hung,
            Slice::Read(attributes) => Slice::Read(attributes.map(|a| node(handle, a))),
        }
    }
}
