//! `ax.snapshot`: the filtered tree rendered as an indented ref'd outline.

use std::time::{Duration, Instant};

use super::walk::{filter_node, label, walk_observed, walk_raw, WalkNode, WalkState};
use super::{AxBackend, AxRegistry, DEFAULT_DEADLINE_MS};
use crate::error::{CoreResult, DesktopError};
use crate::report::ReportMode;
use crate::types::{AxCut, AxSnapshot, AxSnapshotOptions, DesktopWindow};

fn escaped_truncated(value: &str, max: usize) -> String {
    let mut out: String = value.chars().take(max).collect();
    if value.chars().count() > max {
        out.push('…');
    }
    out.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ")
}

fn push_line(text: &mut String, line: &str) {
    if !text.is_empty() {
        text.push('\n');
    }
    text.push_str(line);
}

/// The logical depth a `skeleton` snapshot reads to.
const SKELETON_DEPTH: u32 = 3;

struct TreeWriter<'a> {
    window: &'a DesktopWindow,
    /// The tree starts at a drilled element, not at the window.
    drill: bool,
    registry: &'a mut AxRegistry,
    generation: u64,
    text: String,
    nodes: u32,
    cuts: Vec<AxCut>,
}

impl TreeWriter<'_> {
    fn write(&mut self, node: WalkNode, depth: usize) {
        let reference = self
            .registry
            .register(&self.window.id, self.generation, node.handle);
        let mut line = format!("{}- {}", "  ".repeat(depth), node.props.role);
        if let Some(label) = label(&node.props) {
            line.push_str(&format!(" \"{}\"", escaped_truncated(label, 80)));
        }
        line.push_str(&format!(" [ref={reference}]"));
        let window_root = depth == 0 && !self.drill;
        if window_root {
            line.push_str(&format!(" app={}", self.window.app));
        }
        if let Some(value) = node.props.value.as_deref().filter(|value| !value.is_empty()) {
            line.push_str(&format!(": \"{}\"", escaped_truncated(value, 80)));
        }
        if !node.props.enabled {
            line.push_str(" (disabled)");
        }
        // The root's own AXFocused only reflects app-local focus; report the
        // global roster flag instead.
        let focused = if window_root {
            self.window.focused
        } else {
            node.props.focused
        };
        if focused {
            line.push_str(" (focused)");
        }
        if node.left_out > 0 {
            line.push_str(&format!(" [... {} more]", node.left_out));
            self.registry.mark_subtree_truncated(&reference);
            self.cuts.push(AxCut {
                ref_: reference,
                child_count: node.left_out,
            });
        }
        push_line(&mut self.text, &line);
        self.nodes += 1;
        for child in node.children {
            self.write(child, depth + 1);
        }
    }
}

pub fn snapshot(
    backend: &mut dyn AxBackend,
    registry: &mut AxRegistry,
    window: &DesktopWindow,
    options: &AxSnapshotOptions,
) -> CoreResult<AxSnapshot> {
    let object = registry.report_mode() == ReportMode::Object;
    let timeout = Duration::from_millis(options.timeout_ms.unwrap_or(DEFAULT_DEADLINE_MS));
    // Measured from the request, so the root lookup counts against it; a
    // deadline past what `Instant` can hold never stops the walk.
    let deadline = object.then(|| Instant::now().checked_add(timeout)).flatten();
    // Object mode only: a null-mode reply ignores `root` and `skeleton`.
    let drill = options.root.as_deref().filter(|_| object);
    let (generation, parent, root) = if let Some(reference) = drill {
        let handle = registry.resolve(reference)?;
        if registry.target(reference)? != window.id {
            return Err(DesktopError::invalid_target(format!(
                "{reference} was not read from window {}",
                window.id
            )));
        }
        let parent = registry.generation_of(reference)?;
        let generation = registry.begin_sub_generation(&window.id, parent);
        (generation, Some(parent), handle)
    } else {
        let generation = registry.begin_snapshot(&window.id);
        (generation, None, backend.window_root(window)?)
    };
    let max_depth = options.max_depth.unwrap_or(24);
    let max_depth = if object && options.skeleton == Some(true) {
        max_depth.min(SKELETON_DEPTH)
    } else {
        max_depth
    };
    let mut state = WalkState::new(options.max_nodes.unwrap_or(800).max(1), max_depth)
        .with_deadline(deadline);
    let root = if object {
        walk_observed(backend, root, 0, 0, &mut state)?
    } else {
        walk_raw(backend, root, 0, &mut state)?
    }
    .and_then(|node| filter_node(node, options.all.unwrap_or(false), object));
    let mut writer = TreeWriter {
        window,
        drill: drill.is_some(),
        registry,
        generation,
        text: String::new(),
        nodes: 0,
        cuts: Vec::new(),
    };
    if let Some(root) = root {
        writer.write(root, 0);
    }
    let TreeWriter {
        mut text,
        nodes: node_count,
        cuts,
        ..
    } = writer;
    if state.truncated {
        push_line(&mut text, &format!("… truncated ({} nodes)", state.visited));
    }
    if state.deadline_hit {
        push_line(&mut text, &format!("… deadline {} ms reached", timeout.as_millis()));
    }
    if state.skipped > 0 {
        push_line(
            &mut text,
            &format!("… skipped {} unreadable nodes", state.skipped),
        );
    }
    // `truncated` stays set whenever the snapshot is partial, so a reader
    // that knows only the v1 members keeps its signal.
    Ok(AxSnapshot {
        text,
        node_count,
        truncated: state.truncated,
        generation: object.then_some(generation),
        parent,
        complete: object.then_some(!state.truncated),
        nodes_observed: object.then(|| state.visited.saturating_sub(state.skipped)),
        cuts,
    })
}
