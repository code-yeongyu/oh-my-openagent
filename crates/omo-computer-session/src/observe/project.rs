//! Rendering a generation as the outline the model reads. The default is the skeleton: logical
//! depth 3 (wrappers consume none), no values on cut containers, `actions` off. Nodes past
//! the shown depth are in the generation (and `find` sees them) but not in the text.

use omo_computer_core::ax::{is_wrapper, label, line, root_suffix, LineStyle, NodeRead, MAX_LOGICAL_DEPTH, SKELETON_DEPTH};
use omo_computer_core::observation::Cut;

use crate::diff::{Outline, OutlineLine};
use crate::refs::Generation;

/// How a read is rendered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Style {
    pub skeleton: bool,
    pub depth: Option<u32>,
    pub actions: bool,
}

impl Default for Style {
    fn default() -> Self {
        Self { skeleton: true, depth: None, actions: false }
    }
}

impl Style {
    /// The deepest logical level shown.
    #[must_use]
    pub fn shown_depth(self) -> u32 {
        if self.skeleton {
            self.depth.unwrap_or(SKELETON_DEPTH).min(SKELETON_DEPTH)
        } else {
            self.depth.unwrap_or(MAX_LOGICAL_DEPTH)
        }
    }
}

/// The noise filter: an element is shown when it is named, acts, holds a value or an id, or
/// contains anything; an anonymous inert leaf is not.
fn worth_a_line(read: &NodeRead) -> bool {
    label(read).is_some()
        || !read.actions.is_empty()
        || read.value.is_some()
        || read.native_id.is_some()
        || read.child_count > 0
        || read.secure
}

/// The rendered lines of `generation` and the cuts among them.
#[must_use]
pub fn render(generation: &Generation, style: Style, nodes_observed: u32) -> (Outline, Vec<Cut>) {
    let shown_depth = style.shown_depth();
    let window_root = generation.parent.is_none();
    let mut nearest: Vec<Option<(u64, usize)>> = Vec::with_capacity(generation.entries.len());
    let mut lines = Vec::new();
    let mut cuts = Vec::new();
    for (index, entry) in generation.entries.iter().enumerate() {
        let above = entry.parent.and_then(|parent| nearest[parent]);
        let root = index == 0;
        let shown = root || (!is_wrapper(&entry.read) && entry.logical <= shown_depth && worth_a_line(&entry.read));
        if !shown {
            nearest.push(above);
            continue;
        }
        let indent = above.map_or(0, |(_, indent)| indent + 1);
        let clamped = entry.logical >= shown_depth && entry.read.child_count > 0;
        let more = if clamped { Some(entry.read.child_count) } else { entry.left_out };
        let line_style = LineStyle { actions: style.actions, value: !(style.skeleton && more.is_some()) };
        let mut read = entry.read.clone();
        let extra = if root && window_root {
            read.focused = Some(generation.window_focused);
            root_suffix(&omo_computer_core::ax::RootRead {
                window: generation.window.clone(),
                app: generation.app.clone(),
                focused: generation.window_focused,
                node: NodeRead::default(),
            })
        } else {
            String::new()
        };
        let token = generation.token(index);
        let key = line(&read, &format!("e{}", entry.n), &extra, line_style, more);
        let text = format!("{}{}", "  ".repeat(indent), line(&read, &token, &extra, line_style, more));
        if let Some(child_count) = more {
            cuts.push(Cut { reference: token, child_count });
        }
        lines.push(OutlineLine { n: entry.n, parent: above.map(|(n, _)| n), indent, key, text });
        nearest.push(Some((entry.n, indent)));
    }
    let completeness = if generation.complete { "complete" } else { "partial" };
    let shape = if style.skeleton { format!(" (skeleton depth {shown_depth})") } else { String::new() };
    let trailer = format!("… {nodes_observed} nodes observed, {} shown{shape}; {completeness}", lines.len());
    (Outline { lines, trailer }, cuts)
}
