//! Read-side withholding at the one place the session takes accessibility reads. Every root,
//! child and fresh node passes `secure::withhold` before a tree, a hit, a note, an audit line or
//! a report can see it (row 26; acceptance 17).

use omo_computer_core::ax::{AxHandle, AxReader, NodeRead, RootRead, Slice};
use omo_computer_core::backend::BackendResult;
use omo_computer_core::secure::withhold;

pub(crate) struct Withholding<'a> {
    inner: &'a mut dyn AxReader,
}

impl<'a> Withholding<'a> {
    pub(crate) fn new(inner: &'a mut dyn AxReader) -> Self {
        Self { inner }
    }
}

fn withheld(mut node: NodeRead) -> NodeRead {
    withhold(&mut node);
    node
}

impl AxReader for Withholding<'_> {
    fn now_ms(&self) -> u64 {
        self.inner.now_ms()
    }

    fn deadline_ms(&self) -> u64 {
        self.inner.deadline_ms()
    }

    fn root(&mut self, window: &str) -> BackendResult<RootRead> {
        self.inner.root(window).map(|root| RootRead { node: withheld(root.node), ..root })
    }

    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        match self.inner.children(parent, from, slice_ms) {
            Slice::Read(nodes) => Slice::Read(nodes.into_iter().map(withheld).collect()),
            Slice::Hung => Slice::Hung,
        }
    }

    fn node(&mut self, handle: AxHandle, slice_ms: u64) -> Slice<Option<NodeRead>> {
        match self.inner.node(handle, slice_ms) {
            Slice::Read(node) => Slice::Read(node.map(withheld)),
            Slice::Hung => Slice::Hung,
        }
    }
}
