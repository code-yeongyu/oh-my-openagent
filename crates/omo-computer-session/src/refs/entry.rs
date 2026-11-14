//! What a ref binds to: the `RefEntry` with its evidence tuple, and one window generation.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

use omo_computer_core::ax::{AxHandle, NativeObject, NodeRead, RefToken, Walk, WindowKey};
use omo_computer_core::listing::ElementInfo;
use omo_computer_core::untrusted::UntrustedText;

/// The evidence an element is re-identified by: role, stable text (title or description,
/// never the value), native id and the role path of its ancestors; the bounds hash only
/// breaks a tie.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub role: String,
    pub stable_text: Option<String>,
    /// The label was not read, so `stable_text` proves nothing.
    pub stable_text_unknown: bool,
    pub native_id: Option<String>,
    /// e.g. `window#1/toolbar#1/group#2`: each ancestor's role and its place among the
    /// siblings of that role.
    pub ancestor_path: String,
    /// The element's own path: its ancestor path plus its own `role#place`.
    pub path: String,
    pub bounds_hash: u64,
    /// No other element of the same snapshot carried the same tuple.
    pub unique_at_capture: bool,
}

impl Identity {
    /// The tuple matches `other`, or would if the unread label of either were known.
    #[must_use]
    pub fn may_match(&self, other: &Self) -> bool {
        self.role == other.role
            && self.native_id == other.native_id
            && self.ancestor_path == other.ancestor_path
            && (self.stable_text_unknown || other.stable_text_unknown || self.stable_text == other.stable_text)
    }

    fn key(&self) -> TupleKey<'_> {
        (&self.role, self.stable_text.as_deref(), self.native_id.as_deref(), &self.ancestor_path)
    }
}

/// Role, stable text, native id, ancestor path.
type TupleKey<'a> = (&'a str, Option<&'a str>, Option<&'a str>, &'a str);

#[derive(Debug, Clone, PartialEq)]
pub struct RefEntry {
    pub n: u64,
    pub handle: Option<AxHandle>,
    pub object: Option<NativeObject>,
    pub identity: Identity,
    pub read: NodeRead,
    pub parent: Option<usize>,
    pub depth: u32,
    pub logical: u32,
    /// Children the walk did not read (a cut), or `None`.
    pub left_out: Option<u32>,
}

/// One snapshot of one window (or of one drilled subtree: then `parent` names the generation
/// it hangs under, and it lives and dies with it).
#[derive(Debug, Clone, PartialEq)]
pub struct Generation {
    pub number: u64,
    pub parent: Option<u64>,
    pub window: WindowKey,
    pub app: String,
    /// The roster's focus flag of the window at the read.
    pub window_focused: bool,
    pub complete: bool,
    pub menu_root: bool,
    pub entries: Vec<RefEntry>,
    pub(crate) index: HashMap<u64, usize>,
    pub(crate) last_used: u64,
    /// What the read rendered: the baseline a later `since` diffs against.
    pub outline: Option<crate::diff::Outline>,
    /// A `query` projection: it keeps its own baseline and is never a `since` of a tree.
    pub projection: bool,
}

impl Generation {
    #[must_use]
    pub fn position(&self, n: u64) -> Option<usize> {
        self.index.get(&n).copied()
    }

    #[must_use]
    pub fn token(&self, index: usize) -> String {
        RefToken::Qualified { generation: self.number, n: self.entries[index].n }.to_string()
    }

    /// The `ElementInfo` of entry `index` under its token in this generation.
    #[must_use]
    pub fn element_info(&self, index: usize) -> ElementInfo {
        let entry = &self.entries[index];
        let read = &entry.read;
        ElementInfo {
            reference: self.token(index),
            role: read.role.clone(),
            label: omo_computer_core::ax::label(read).map(str::to_owned),
            native_role: read.native_role.clone(),
            title: read.title.clone(),
            description: read.description.clone(),
            value: if read.secure { None } else { read.value.clone() },
            enabled: read.enabled,
            focused: read.focused,
            child_count: Some(read.child_count),
            bounds: read.bounds,
            actions: Some(read.actions.clone()),
            window: self.window.id.clone(),
            generation: self.number,
            observation: UntrustedText,
        }
    }
}

fn bounds_hash(read: &NodeRead) -> u64 {
    let mut hasher = DefaultHasher::new();
    if let Some(bounds) = read.bounds {
        for side in [bounds.x, bounds.y, bounds.width, bounds.height] {
            format!("{:.0}", side.round()).hash(&mut hasher);
        }
    }
    hasher.finish()
}

/// The identity tuple of every node of `walk`, in walk order. A drilled walk passes the
/// identity of its root element, so the paths under it continue the window's paths.
#[must_use]
pub fn identities(walk: &Walk, drilled: Option<&Identity>) -> Vec<Identity> {
    let mut paths: Vec<String> = Vec::with_capacity(walk.nodes.len());
    let mut sibling_roles: HashMap<(Option<usize>, &str), u32> = HashMap::new();
    let mut out: Vec<Identity> = Vec::with_capacity(walk.nodes.len());
    for node in &walk.nodes {
        let place = sibling_roles.entry((node.parent, node.read.role.as_str())).or_insert(0);
        *place += 1;
        let (ancestor_path, own) = match (node.parent, drilled) {
            (None, Some(root)) => (root.ancestor_path.clone(), root.path.clone()),
            (None, None) => (String::new(), format!("{}#{place}", node.read.role)),
            (Some(parent), _) => {
                let above = paths[parent].clone();
                let own = format!("{above}/{}#{place}", node.read.role);
                (above, own)
            }
        };
        paths.push(own.clone());
        out.push(Identity {
            role: node.read.role.clone(),
            stable_text: node.read.stable_text().map(str::to_owned),
            stable_text_unknown: node.read.stable_text_unknown(),
            native_id: node.read.native_id.clone(),
            ancestor_path,
            path: own,
            bounds_hash: bounds_hash(&node.read),
            unique_at_capture: true,
        });
    }
    let mut counts: HashMap<TupleKey<'_>, u32> = HashMap::new();
    for identity in &out {
        *counts.entry(identity.key()).or_insert(0) += 1;
    }
    let unique: Vec<bool> = out.iter().map(|identity| counts[&identity.key()] == 1).collect();
    for (identity, unique) in out.iter_mut().zip(unique) {
        identity.unique_at_capture = unique;
    }
    out
}
