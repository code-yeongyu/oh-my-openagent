//! A scripted accessibility tree for the registry and observe tests: windows with versions of
//! their tree, native objects that live across versions, hung controls and a read counter.

use std::collections::{HashMap, HashSet};

use omo_computer_core::ax::{AxHandle, AxReader, Evidence, NativeObject, NodeRead, RootRead, Seen, Slice, WindowKey};
use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::EngineCode;
use omo_computer_core::listing::Rect;

/// One scripted element. `object` is the native object the backend reports; an element
/// without one gets a handle that dies with its tree version.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub read: NodeRead,
    pub object: Option<u64>,
    pub children: Vec<Node>,
}

pub fn el(role: &str, title: &str) -> Node {
    let title = (!title.is_empty()).then(|| title.to_owned());
    Node {
        read: NodeRead {
            role: role.to_owned(),
            evidence: Evidence::of(title.is_some(), false, false),
            title,
            ..NodeRead::default()
        },
        object: None,
        children: Vec::new(),
    }
}

impl Node {
    pub const fn obj(mut self, object: u64) -> Self {
        self.object = Some(object);
        self
    }

    pub fn id(mut self, native_id: &str) -> Self {
        self.read.native_id = Some(native_id.to_owned());
        self
    }

    pub fn value(mut self, value: &str) -> Self {
        self.read.value = Some(value.to_owned());
        self.read.evidence.value = Seen::Known;
        self
    }

    pub fn at(mut self, x: f64, y: f64) -> Self {
        self.read.bounds = Some(Rect { x, y, width: 10.0, height: 10.0 });
        self
    }

    pub fn unread_title(mut self) -> Self {
        self.read.title = None;
        self.read.evidence.title = Seen::Unknown;
        self
    }

    pub fn kids(mut self, children: Vec<Self>) -> Self {
        self.children = children;
        self
    }
}

struct Window {
    key: WindowKey,
    versions: Vec<Node>,
    current: usize,
}

#[derive(Default)]
pub struct Tree {
    windows: HashMap<String, Window>,
    now: u64,
    pub hung: HashSet<u64>,
    /// Reads of any kind served so far.
    pub reads: u32,
}

impl Tree {
    pub fn window(mut self, id: &str, pid: u32, versions: Vec<Node>) -> Self {
        let key = WindowKey { id: id.to_owned(), pid, process_start: 1 };
        self.windows.insert(id.to_owned(), Window { key, versions, current: 0 });
        self
    }

    /// Serves version `index` of `window`'s tree from now on.
    pub fn show(&mut self, window: &str, index: usize) {
        if let Some(window) = self.windows.get_mut(window) {
            window.current = index;
        }
    }

    /// The window now belongs to another process (relaunch).
    pub fn relaunch(&mut self, window: &str, pid: u32) {
        if let Some(window) = self.windows.get_mut(window) {
            window.key.pid = pid;
        }
    }

    fn handle_of(version: usize, path: &[usize], node: &Node) -> u64 {
        node.object.unwrap_or_else(|| {
            let mut handle = 1_u64 << 40 | u64::try_from(version).unwrap_or(0) << 32;
            for step in path {
                handle = handle.wrapping_mul(31).wrapping_add(u64::try_from(*step).unwrap_or(0) + 1);
            }
            handle | 1 << 40
        })
    }

    fn served(version: usize, path: &[usize], node: &Node) -> NodeRead {
        let mut read = node.read.clone();
        read.handle = Some(AxHandle(Self::handle_of(version, path, node)));
        read.object = node.object.map(NativeObject);
        read.child_count = u32::try_from(node.children.len()).unwrap_or(u32::MAX);
        read
    }

    /// Every live element: (handle, its path, the node) in the current versions.
    fn find(&self, handle: u64) -> Option<(usize, Vec<usize>, &Node)> {
        fn visit<'a>(version: usize, path: &mut Vec<usize>, node: &'a Node, handle: u64) -> Option<(usize, Vec<usize>, &'a Node)> {
            if Tree::handle_of(version, path, node) == handle {
                return Some((version, path.clone(), node));
            }
            for (i, child) in node.children.iter().enumerate() {
                path.push(i);
                let found = visit(version, path, child, handle);
                path.pop();
                if found.is_some() {
                    return found;
                }
            }
            None
        }
        self.windows
            .values()
            .find_map(|window| visit(window.current, &mut Vec::new(), &window.versions[window.current], handle))
    }
}

impl AxReader for Tree {
    fn now_ms(&self) -> u64 {
        self.now
    }

    fn root(&mut self, window: &str) -> BackendResult<RootRead> {
        self.reads += 1;
        let window = self.windows.get(window).ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
        let root = &window.versions[window.current];
        Ok(RootRead {
            window: window.key.clone(),
            app: "Notes".to_owned(),
            focused: true,
            node: Self::served(window.current, &[], root),
        })
    }

    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        self.reads += 1;
        if self.hung.contains(&parent.0) {
            self.now += slice_ms;
            return Slice::Hung;
        }
        self.now += 1;
        let Some((version, path, node)) = self.find(parent.0) else { return Slice::Read(Vec::new()) };
        let from = usize::try_from(from).unwrap_or(usize::MAX);
        let read = node
            .children
            .iter()
            .enumerate()
            .skip(from)
            .map(|(i, child)| {
                let mut at = path.clone();
                at.push(i);
                Self::served(version, &at, child)
            })
            .collect();
        Slice::Read(read)
    }

    fn node(&mut self, handle: AxHandle, slice_ms: u64) -> Slice<Option<NodeRead>> {
        self.reads += 1;
        if self.hung.contains(&handle.0) {
            self.now += slice_ms;
            return Slice::Hung;
        }
        Slice::Read(self.find(handle.0).map(|(version, path, node)| Self::served(version, &path, node)))
    }
}
