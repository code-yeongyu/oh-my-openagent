//! `ax.snapshot`: the filtered tree rendered as an indented ref'd outline.

use super::walk::{filter_node, label, walk_raw, WalkNode, WalkState};
use super::{AxBackend, AxRegistry};
use crate::error::CoreResult;
use crate::types::{AxSnapshot, AxSnapshotOptions, DesktopWindow};

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
    let generation = registry.begin_snapshot(&window.id);
    let root = backend.window_root(window)?;
    let mut state = WalkState::new(
        options.max_nodes.unwrap_or(800).max(1),
        options.max_depth.unwrap_or(24),
    );
    let root = walk_raw(backend, root, 0, &mut state)?
        .and_then(|node| filter_node(node, options.all.unwrap_or(false)));
    let mut writer = TreeWriter {
        window,
        registry,
        generation,
        text: String::new(),
        nodes: 0,
    };
    if let Some(root) = root {
        writer.write(root, 0);
    }
    let TreeWriter {
        mut text,
        nodes: node_count,
        ..
    } = writer;
    if state.truncated {
        push_line(&mut text, &format!("… truncated ({} nodes)", state.visited));
    }
    if state.skipped > 0 {
        push_line(
            &mut text,
            &format!("… skipped {} unreadable nodes", state.skipped),
        );
    }
    Ok(AxSnapshot {
        text,
        node_count,
        truncated: state.truncated,
    })
}
