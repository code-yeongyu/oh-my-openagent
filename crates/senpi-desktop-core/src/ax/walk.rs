//! Raw tree walk with depth/node budgets, and the default noise filter.

use super::{AxBackend, AxHandle, AxProps};
use crate::error::CoreResult;

#[derive(Clone)]
pub(super) struct WalkNode {
    pub(super) handle: AxHandle,
    pub(super) props: AxProps,
    pub(super) children: Vec<Self>,
}

pub(super) struct WalkState {
    pub(super) visited: u32,
    pub(super) skipped: u32,
    max_nodes: u32,
    max_depth: u32,
    pub(super) truncated: bool,
}

impl WalkState {
    pub(super) const fn new(max_nodes: u32, max_depth: u32) -> Self {
        Self {
            visited: 0,
            skipped: 0,
            max_nodes,
            max_depth,
            truncated: false,
        }
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
        children,
    }))
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

fn interactable(props: &AxProps) -> bool {
    !props.actions.is_empty()
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

/// Keeps interactable/named nodes and non-empty structure; collapses
/// anonymous single-child groups. `all` keeps everything.
pub(super) fn filter_node(mut node: WalkNode, all: bool) -> Option<WalkNode> {
    node.children = node
        .children
        .into_iter()
        .filter_map(|child| filter_node(child, all))
        .collect();
    if all {
        return Some(node);
    }
    let keep_self = interactable(&node.props) || named(&node.props);
    if !keep_self && node.props.role == "group" && node.children.len() == 1 {
        return node.children.pop();
    }
    if keep_self || (structural(&node.props.role) && !node.children.is_empty()) {
        Some(node)
    } else {
        None
    }
}
