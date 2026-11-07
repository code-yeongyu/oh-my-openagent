//! `ax.snapshot`: the filtered tree rendered as an indented ref'd outline.

use std::time::{Duration, Instant};

use super::walk::{filter_node, label, walk_observed, walk_raw, WalkNode, WalkState};
use super::{AxBackend, AxRegistry, DEFAULT_DEADLINE_MS};
use crate::error::CoreResult;
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

struct TreeWriter<'a> {
    window: &'a DesktopWindow,
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
        if depth == 0 {
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
        let focused = if depth == 0 {
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
    let generation = registry.begin_snapshot(&window.id);
    let root = backend.window_root(window)?;
    let mut state = WalkState::new(
        options.max_nodes.unwrap_or(800).max(1),
        options.max_depth.unwrap_or(24),
    )
    .with_deadline(deadline);
    let root = if object {
        walk_observed(backend, root, 0, &mut state)?
    } else {
        walk_raw(backend, root, 0, &mut state)?
    }
    .and_then(|node| filter_node(node, options.all.unwrap_or(false)));
    let mut writer = TreeWriter {
        window,
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
        generation: None,
        parent: None,
        complete: object.then_some(!state.truncated),
        nodes_observed: object.then(|| state.visited.saturating_sub(state.skipped)),
        cuts,
    })
}
