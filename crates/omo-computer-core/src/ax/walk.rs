//! The bounded walk: one window (or one drilled subtree) read through a backend's reader under
//! a deadline, a per-IPC slice, a node budget and a logical depth. Every limit is data in the
//! result: a node whose children were not all read is a cut, never a thrown `Timeout`.

use super::node::{AxHandle, NodeRead, RootRead, Seen};
use super::{DEADLINE_MS, MAX_LOGICAL_DEPTH, NODE_BUDGET, SLICE_MS};
use crate::backend::BackendResult;

/// One read IPC's answer: the value, or nothing because the control did not answer inside
/// its slice.
#[derive(Debug, Clone, PartialEq)]
pub enum Slice<T> {
    Read(T),
    Hung,
}

/// The accessibility reads a backend offers the walk and the ref resolution.
pub trait AxReader {
    /// The reader's clock in milliseconds.
    fn now_ms(&self) -> u64;

    /// The deadline a walk honours, measured from its first read.
    fn deadline_ms(&self) -> u64 {
        DEADLINE_MS
    }

    /// The root of `window` with the window's identity.
    ///
    /// # Errors
    /// The window is gone or has no tree.
    fn root(&mut self, window: &str) -> BackendResult<RootRead>;

    /// Children of `parent` from index `from` on, as many as fit in `slice_ms`.
    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>>;

    /// A fresh read of the element behind `handle`; `None` when the element is gone.
    fn node(&mut self, handle: AxHandle, slice_ms: u64) -> Slice<Option<NodeRead>>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub deadline_ms: u64,
    pub slice_ms: u64,
    pub node_budget: u32,
    pub max_logical_depth: u32,
}

impl Limits {
    /// The design's defaults under `reader`'s deadline.
    #[must_use]
    pub fn of(reader: &dyn AxReader) -> Self {
        Self {
            deadline_ms: reader.deadline_ms().min(DEADLINE_MS),
            slice_ms: SLICE_MS,
            node_budget: NODE_BUDGET,
            max_logical_depth: MAX_LOGICAL_DEPTH,
        }
    }
}

/// One walked element, in document order.
#[derive(Debug, Clone, PartialEq)]
pub struct WalkNode {
    pub read: NodeRead,
    pub parent: Option<usize>,
    /// Raw depth from the walk root.
    pub depth: u32,
    /// Depth counting only non-wrapper ancestors.
    pub logical: u32,
    /// Children read; less than `read.child_count` on a cut.
    pub children_read: u32,
    /// The control did not answer a read of its children inside the slice.
    pub hung: bool,
}

impl WalkNode {
    /// The walk stopped above some of this node's children.
    #[must_use]
    pub const fn is_cut(&self) -> bool {
        self.children_read < self.read.child_count || self.hung
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Walk {
    pub nodes: Vec<WalkNode>,
    /// Every node under the root was read.
    pub complete: bool,
    pub elapsed_ms: u64,
}

/// A container with no title, value, description or native id whose only action, if any,
/// scrolls it into view: it consumes raw depth but no logical depth, and is not rendered.
/// A label the read could not see is not proof of absence.
#[must_use]
pub fn is_wrapper(node: &NodeRead) -> bool {
    let blank = |field: &Option<String>| field.as_deref().is_none_or(|text| text.trim().is_empty());
    let scrolls = |action: &String| {
        let name: String = action
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .map(|c| c.to_ascii_lowercase())
            .collect();
        let name = name.strip_prefix("ax").unwrap_or(&name);
        matches!(name, "scrolltovisible" | "scrollintoview")
    };
    node.child_count > 0
        && !node.evidence.any_unknown()
        && blank(&node.title)
        && blank(&node.value)
        && blank(&node.description)
        && blank(&node.native_id)
        && node.actions.iter().all(scrolls)
}

struct Pending {
    read: NodeRead,
    parent: Option<usize>,
    depth: u32,
    logical: u32,
}

/// Walks from `root` (a window root or a drilled element) in document order.
pub fn walk(reader: &mut dyn AxReader, root: NodeRead, limits: &Limits) -> Walk {
    let start = reader.now_ms();
    let deadline = start.saturating_add(limits.deadline_ms);
    let mut nodes: Vec<WalkNode> = Vec::new();
    let mut stack = vec![Pending {
        read: root,
        parent: None,
        depth: 0,
        logical: 0,
    }];
    let mut observed: u32 = 1;
    while let Some(pending) = stack.pop() {
        let index = nodes.len();
        let child_logical = pending.logical + u32::from(!is_wrapper(&pending.read));
        let mut node = WalkNode {
            read: pending.read,
            parent: pending.parent,
            depth: pending.depth,
            logical: pending.logical,
            children_read: 0,
            hung: false,
        };
        let mut children = Vec::new();
        if node.read.child_count > 0 && child_logical <= limits.max_logical_depth {
            let handle = node.read.handle;
            while let Some(handle) = handle {
                let read = node.children_read;
                let remaining = deadline.saturating_sub(reader.now_ms());
                if read >= node.read.child_count || remaining == 0 || observed >= limits.node_budget {
                    break;
                }
                match reader.children(handle, read, limits.slice_ms.min(remaining)) {
                    Slice::Hung => {
                        node.hung = true;
                        break;
                    }
                    Slice::Read(batch) if batch.is_empty() => break,
                    Slice::Read(batch) => {
                        let room = limits.node_budget - observed;
                        for child in batch.into_iter().take(usize::try_from(room).unwrap_or(usize::MAX)) {
                            children.push(child);
                            node.children_read += 1;
                            observed += 1;
                        }
                    }
                }
            }
        }
        if node.hung {
            node.read.evidence.value = Seen::Unknown;
        }
        let depth = node.depth + 1;
        nodes.push(node);
        stack.extend(children.into_iter().rev().map(|read| Pending {
            read,
            parent: Some(index),
            depth,
            logical: child_logical,
        }));
    }
    Walk {
        complete: nodes.iter().all(|node| !node.is_cut()),
        nodes,
        elapsed_ms: reader.now_ms().saturating_sub(start),
    }
}
