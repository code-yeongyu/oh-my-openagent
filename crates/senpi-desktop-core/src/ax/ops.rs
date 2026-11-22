//! `ax.query` / `ax.elementAt` / ref registration and the press action.

use super::walk::{label, walk_observed, walk_raw, WalkState};
use super::{AxBackend, AxHandle, AxObserved, AxRegistry};
use crate::error::CoreResult;
use crate::report::ReportMode;
use crate::types::{AxNode, AxQuery, DesktopWindow};

const QUERY_MAX_NODES: u32 = 5_000;
const QUERY_MAX_DEPTH: u32 = 24;

/// The wire node for `reference`. `observed` carries evidence and `secure`
/// only when an object-mode read produced it, so null-mode nodes keep today's
/// members.
pub fn node_to_wire(reference: String, observed: AxObserved, subtree_truncated: bool) -> AxNode {
    let AxObserved {
        props,
        evidence,
        secure,
    } = observed;
    let (x, y, width, height) = props.bounds.map_or((None, None, None, None), |b| {
        (Some(b.x), Some(b.y), Some(b.width), Some(b.height))
    });
    AxNode {
        evidence,
        subtree_truncated,
        secure,
        ref_: reference,
        role: props.role,
        native_role: props.native_role,
        title: props.title,
        value: props.value,
        description: props.description,
        enabled: props.enabled,
        focused: props.focused,
        x,
        y,
        width,
        height,
        actions: (!props.actions.is_empty()).then_some(props.actions),
        child_count: props.child_count,
    }
}

/// Case-insensitive substring match on role, label, and value over the
/// unfiltered tree, in document order.
pub fn query(
    backend: &mut dyn AxBackend,
    registry: &mut AxRegistry,
    window: &DesktopWindow,
    query: &AxQuery,
) -> CoreResult<Vec<AxNode>> {
    let target = &window.id;
    let generation = registry.current_generation(target);
    let root = backend.window_root(window)?;
    let mut state = WalkState::new(QUERY_MAX_NODES, QUERY_MAX_DEPTH);
    let root = if registry.report_mode() == ReportMode::Object {
        walk_observed(backend, root, 0, 0, &mut state)?
    } else {
        walk_raw(backend, root, 0, &mut state)?
    };
    let Some(root) = root else {
        return Ok(Vec::new());
    };
    let role = query.role.as_deref().map(str::to_lowercase);
    let title = query.title.as_deref().map(str::to_lowercase);
    let value = query.value.as_deref().map(str::to_lowercase);
    let limit = usize::try_from(query.limit.unwrap_or(100).min(QUERY_MAX_NODES)).unwrap_or(usize::MAX);
    let contains = |actual: Option<&str>, expected: Option<&String>| {
        expected.is_none_or(|needle| actual.is_some_and(|text| text.to_lowercase().contains(needle)))
    };
    let mut result = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        stack.extend(node.children.iter().rev().cloned());
        if contains(Some(&node.props.role), role.as_ref())
            && contains(label(&node.props), title.as_ref())
            && contains(node.props.value.as_deref(), value.as_ref())
        {
            let reference = registry.register(target, generation, node.handle);
            let observed = AxObserved {
                props: node.props,
                evidence: node.evidence,
                secure: node.secure,
            };
            result.push(node_to_wire(reference, observed, false));
            if result.len() >= limit {
                break;
            }
        }
    }
    Ok(result)
}

pub fn register_node(
    backend: &mut dyn AxBackend,
    registry: &mut AxRegistry,
    target: &str,
    handle: AxHandle,
) -> CoreResult<AxNode> {
    let observed = observe(backend, registry, &handle)?;
    let generation = registry.current_generation(target);
    let reference = registry.register(target, generation, handle);
    Ok(node_to_wire(reference, observed, false))
}

/// Reads `handle` as the session's report mode asks: with evidence in object
/// mode, plain props otherwise.
pub fn observe(backend: &mut dyn AxBackend, registry: &AxRegistry, handle: &AxHandle) -> CoreResult<AxObserved> {
    if registry.report_mode() == ReportMode::Object {
        backend.observe(handle)
    } else {
        backend.props(handle).map(AxObserved::plain)
    }
}

/// Hit-test at global logical desktop coordinates; needs no prior capture.
pub fn element_at_node(
    backend: &mut dyn AxBackend,
    registry: &mut AxRegistry,
    target: &str,
    x: f64,
    y: f64,
) -> CoreResult<Option<AxNode>> {
    let Some(handle) = backend.element_at(x, y)? else {
        return Ok(None);
    };
    register_node(backend, registry, target, handle).map(Some)
}

pub fn ax_press(backend: &mut dyn AxBackend, handle: &AxHandle) -> CoreResult<()> {
    backend.perform(handle, "press")
}
