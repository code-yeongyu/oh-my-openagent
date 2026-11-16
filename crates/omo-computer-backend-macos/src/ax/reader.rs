//! `MacAx`: the macOS accessibility backend over one AX server (RED stub).

use omo_computer_core::ax::{AxHandle, AxReader, NodeRead, RootRead, Slice};
use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::{EngineCode, Reason};

use super::handles::Handles;
use super::notifications::Surface;
use super::seam::{AxServer, Element, WindowOwner};

pub const CHILD_BATCH: u32 = 64;

pub struct MacAx<S> {
    pub(crate) server: S,
    pub(crate) handles: Handles,
    pub(crate) surface: Surface,
}

impl<S: AxServer> MacAx<S> {
    pub fn new(server: S) -> Self {
        Self {
            server,
            handles: Handles::default(),
            surface: Surface::default(),
        }
    }

    pub const fn server(&self) -> &S {
        &self.server
    }

    pub const fn server_mut(&mut self) -> &mut S {
        &mut self.server
    }

    pub(crate) fn ensure_observed(&mut self, pid: u32) {
        let _ = pid;
    }

    pub(crate) fn window(&mut self, id: &str) -> BackendResult<(u32, WindowOwner, Element)> {
        let _ = id;
        Err(Refusal::new(
            EngineCode::AxUnsupported,
            Reason::SnapshotUnsupported,
        ))
    }
}

impl<S: AxServer> AxReader for MacAx<S> {
    fn now_ms(&self) -> u64 {
        self.server.now_ms()
    }

    fn root(&mut self, window: &str) -> BackendResult<RootRead> {
        self.window(window).map(|_| unreachable!("stub"))
    }

    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        let _ = (parent, from, slice_ms);
        Slice::Read(Vec::new())
    }

    fn node(&mut self, handle: AxHandle, slice_ms: u64) -> Slice<Option<NodeRead>> {
        let _ = (handle, slice_ms);
        Slice::Read(None)
    }
}
