//! Raw tree walk with depth/node budgets, the object-mode partial walk, and
//! the default noise filter.

use std::time::Instant;

use super::wrapper::{is_wrapper, scroll_into_view, WRAPPER_RAW_ALLOWANCE};
use super::{AxBackend, AxHandle, AxObserved, AxProps};
use crate::error::CoreResult;
use crate::types::AxEvidence;

#[derive(Clone)]
pub(super) struct WalkNode {
    pub(super) handle: AxHandle,
    pub(super) props: AxProps,
    pub(super) evidence: Option<AxEvidence>,
    pub(super) secure: bool,
    /// Children the walk left out of `children` (object mode).
    pub(super) left_out: u32,
    pub(super) children: Vec<Self>,
}

pub(super) struct WalkState {
    pub(super) visited: u32,
    pub(super) skipped: u32,
    max_nodes: u32,
    max_depth: u32,
    pub(super) truncated: bool,
    /// When the object-mode walk stops reading; `None` never stops.
    deadline: Option<Instant>,
    pub(super) deadline_hit: bool,
}

impl WalkState {
    pub(super) const fn new(max_nodes: u32, max_depth: u32) -> Self {
        Self {
            visited: 0,
            skipped: 0,
            max_nodes,
            max_depth,
            truncated: false,
            deadline: None,
            deadline_hit: false,
        }
    }

    pub(super) const fn with_deadline(mut self, deadline: Option<Instant>) -> Self {
        self.deadline = deadline;
        self
    }

    /// Whether the object-mode walk must stop before reading another node.
    /// Checked between nodes only: one slow `observe`/`children` call (or the
    /// root's mandatory read) can overrun the deadline, bounded by the
    /// operation timeout.
    fn spent(&mut self) -> bool {
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.deadline_hit = true;
        }
        self.deadline_hit || self.visited >= self.max_nodes
    }
}

/// Walks from `handle`; unreadable non-root nodes are skipped and counted.
pub(super) fn walk_raw(
    backend: &mut dyn AxBackend,
    handle: AxHandle,
    depth: u32,
    state: &mut WalkState,
) -> CoreResult<Option<WalkNode>> {
    if depth > state.max_depth || state.visited >= state.max_nodes {
        state.truncated = true;
        return Ok(None);
    }
    state.visited += 1;
    let props = match backend.props(&handle) {
        Ok(props) => props,
        Err(_) if depth > 0 => {
            state.skipped = state.skipped.saturating_add(1);
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let child_handles = match backend.children(&handle) {
        Ok(children) => children,
        Err(_) if depth > 0 => {
            state.skipped = state.skipped.saturating_add(1);
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let mut children = Vec::new();
    for child in child_handles {
        if let Some(child) = walk_raw(backend, child, depth + 1, state)? {
            children.push(child);
        }
        if state.truncated && state.visited >= state.max_nodes {
            break;
        }
    }
    Ok(Some(WalkNode {
        handle,
        props,
        evidence: None,
        secure: false,
        left_out: 0,
        children,
    }))
}

/// The object-mode walk: reads through `observe`, and where a budget (depth,
/// nodes, deadline) stops it, keeps the node and counts the children it left
/// out instead of failing or dropping them. The root is always read.
///
/// `max_depth` bounds the logical depth: `logical` is this node's depth
/// unless it is a web wrapper, which sits at its parent's logical depth.
/// Raw depth stops `WRAPPER_RAW_ALLOWANCE` levels past `max_depth`.
pub(super) fn walk_observed(
    backend: &mut dyn AxBackend,
    handle: AxHandle,
    depth: u32,
    logical: u32,
    state: &mut WalkState,
) -> CoreResult<Option<WalkNode>> {
    state.visited += 1;
    let AxObserved {
        props,
        evidence,
        secure,
    } = match backend.observe(&handle) {
        Ok(observed) => observed,
        Err(_) if depth > 0 => {
            state.skipped = state.skipped.saturating_add(1);
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let mut node = WalkNode {
        handle,
        props,
        evidence,
        secure,
        left_out: 0,
        children: Vec::new(),
    };
    let logical = if depth > 0
        && is_wrapper(&node.props, node.evidence.as_ref(), || {
            backend.identifier(&node.handle).ok().flatten()
        }) {
        logical.saturating_sub(1)
    } else {
        logical
    };
    if logical >= state.max_depth
        || depth >= state.max_depth.saturating_add(WRAPPER_RAW_ALLOWANCE)
    {
        node.left_out = node.props.child_count;
        state.truncated |= node.left_out > 0;
        return Ok(Some(node));
    }
    let child_handles = match backend.children(&node.handle) {
        Ok(children) => children,
        Err(_) if depth > 0 => {
            state.skipped = state.skipped.saturating_add(1);
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let total = child_handles.len();
    for (index, child) in child_handles.into_iter().enumerate() {
        if state.spent() {
            state.truncated = true;
            node.left_out = u32::try_from(total - index).unwrap_or(u32::MAX);
            break;
        }
        if let Some(child) = walk_observed(backend, child, depth + 1, logical + 1, state)? {
            node.children.push(child);
        }
    }
    Ok(Some(node))
}

fn named(props: &AxProps) -> bool {
    [&props.title, &props.value, &props.description]
        .into_iter()
        .flatten()
        .any(|value| !value.trim().is_empty())
}

/// Display and match name for a node. Many toolbar controls — Chrome's
/// Back/Forward/Reload among them — carry no `AXTitle` and name themselves
/// through `AXDescription` alone.
pub(super) fn label(props: &AxProps) -> Option<&str> {
    [props.title.as_deref(), props.description.as_deref()]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|label| !label.is_empty())
}

/// `object` reads a scroll-into-view-only action list as no action (the
/// web-wrapper rule); null mode keeps today's filter.
fn interactable(props: &AxProps, object: bool) -> bool {
    props.actions.iter().any(|action| !object || !scroll_into_view(action))
        || matches!(
            props.role.as_str(),
            "button"
                | "checkbox"
                | "radio"
                | "textfield"
                | "textarea"
                | "link"
                | "menuitem"
                | "tab"
                | "slider"
                | "combobox"
                | "popupbutton"
                | "listitem"
                | "outlineitem"
                | "cell"
        )
}

fn structural(role: &str) -> bool {
    matches!(
        role,
        "window"
            | "group"
            | "webarea"
            | "list"
            | "table"
            | "row"
            | "menu"
            | "menubar"
            | "tabgroup"
            | "toolbar"
            | "scrollarea"
            | "outline"
    )
}

fn holds_cut(node: &WalkNode) -> bool {
    node.left_out > 0 || node.children.iter().any(holds_cut)
}

/// Keeps interactable/named nodes and non-empty structure; collapses
/// anonymous single-child groups. `all` keeps everything.
pub(super) fn filter_node(mut node: WalkNode, all: bool, object: bool) -> Option<WalkNode> {
    node.children = node
        .children
        .into_iter()
        .filter_map(|child| filter_node(child, all, object))
        .collect();
    if all {
        return Some(node);
    }
    // A cut node stays: its ref is where a drill-down resumes.
    let keep_self = interactable(&node.props, object) || named(&node.props) || node.left_out > 0;
    if !keep_self && node.props.role == "group" && node.children.len() == 1 {
        return node.children.pop();
    }
    // Any parent of a kept cut stays too, whatever its role, so the cut is
    // always rendered and listed. `left_out` is set in object mode only.
    if keep_self
        || (structural(&node.props.role) && !node.children.is_empty())
        || node.children.iter().any(holds_cut)
    {
        Some(node)
    } else {
        None
    }
}
