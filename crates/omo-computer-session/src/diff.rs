//! Lossless-or-full: a read that names `since` gets a diff only when every gate holds -
//! baseline in the window, both reads complete, same window identity, no menu root, the
//! surviving elements in their old relative order, not a `query` projection, and the diff
//! strictly shorter than the full tree. Otherwise the full tree with the failing gate's reason.
//! Nodes are keyed by element number, never by line position.

use std::collections::{HashMap, HashSet};

use omo_computer_core::ax::{DiffFallback, WindowKey};

/// One rendered line: the element, its nearest rendered ancestor, its indentation, the line
/// with the generation-free ref `e<n>` (what a change is judged on) and the line as shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutlineLine {
    pub n: u64,
    pub parent: Option<u64>,
    pub indent: usize,
    pub key: String,
    pub text: String,
}

/// A rendered read: its lines in document order and its trailer line.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Outline {
    pub lines: Vec<OutlineLine>,
    pub trailer: String,
}

impl Outline {
    /// The full tree text.
    #[must_use]
    pub fn text(&self) -> String {
        let mut out: Vec<&str> = self.lines.iter().map(|line| line.text.as_str()).collect();
        out.push(&self.trailer);
        out.join("\n")
    }
}

/// One side of a diff: what was rendered and under which window and read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Side {
    pub generation: u64,
    pub outline: Outline,
    pub complete: bool,
    pub menu_root: bool,
    pub window: WindowKey,
    pub projection: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Diff(String),
    Full(DiffFallback),
}

/// The gates in their table order, then the diff itself. A `query` projection never diffs,
/// and a projection is never the baseline of a tree.
#[must_use]
pub fn decide(baseline: Option<&Side>, current: &Side, nodes_observed: u32) -> Decision {
    if current.projection {
        return Decision::Full(DiffFallback::QueryProjection);
    }
    let Some(baseline) = baseline else {
        return Decision::Full(DiffFallback::SinceExpired);
    };
    let gates = [
        (!baseline.complete, DiffFallback::BaselineIncomplete),
        (!current.complete, DiffFallback::CurrentIncomplete),
        (baseline.window != current.window, DiffFallback::WindowChanged),
        (baseline.menu_root || current.menu_root, DiffFallback::MenuRoot),
        (reordered(&baseline.outline, &current.outline), DiffFallback::Reordered),
        (baseline.projection, DiffFallback::QueryProjection),
    ];
    if let Some((_, reason)) = gates.iter().find(|(failed, _)| *failed) {
        return Decision::Full(*reason);
    }
    let diff = render(baseline, current, nodes_observed);
    if diff.chars().count() >= current.outline.text().chars().count() {
        return Decision::Full(DiffFallback::NotShorter);
    }
    Decision::Diff(diff)
}

/// The survivors, compared as sequences of element numbers, are not in their old order.
fn reordered(baseline: &Outline, current: &Outline) -> bool {
    let now: HashSet<u64> = current.lines.iter().map(|line| line.n).collect();
    let old: HashSet<u64> = baseline.lines.iter().map(|line| line.n).collect();
    let before = baseline.lines.iter().map(|line| line.n).filter(|n| now.contains(n));
    let after = current.lines.iter().map(|line| line.n).filter(|n| old.contains(n));
    !before.eq(after)
}

fn render(baseline: &Side, current: &Side, nodes_observed: u32) -> String {
    let old: HashMap<u64, &OutlineLine> = baseline.outline.lines.iter().map(|line| (line.n, line)).collect();
    let mut out: Vec<String> = Vec::new();
    let mut added_root_indent: Option<usize> = None;
    for line in &current.outline.lines {
        let body = line.text.trim_start();
        match old.get(&line.n) {
            None => {
                let base = *added_root_indent.get_or_insert(line.indent);
                let base = if line.indent < base {
                    added_root_indent = Some(line.indent);
                    line.indent
                } else {
                    base
                };
                out.push(format!("+ {}{body}", "  ".repeat(line.indent - base)));
            }
            Some(before) => {
                added_root_indent = None;
                if before.key != line.key || before.parent != line.parent {
                    out.push(format!("~ {body}"));
                }
            }
        }
    }
    let changed = out.len();
    let present: HashSet<u64> = current.outline.lines.iter().map(|line| line.n).collect();
    let mut gone: Vec<u64> = baseline.outline.lines.iter().map(|line| line.n).filter(|n| !present.contains(n)).collect();
    gone.sort_unstable();
    if out.is_empty() && gone.is_empty() {
        out.push("no changes".to_owned());
    }
    if !gone.is_empty() {
        out.push(format!("removed: {}", ranges(&gone)));
    }
    out.push(format!(
        "… {nodes_observed} nodes observed; diff vs s{} ({changed} lines of {})",
        baseline.generation,
        current.outline.lines.len()
    ));
    out.join("\n")
}

/// `e12-e19, e44`: sorted numbers, runs compressed.
fn ranges(sorted: &[u64]) -> String {
    let mut runs: Vec<(u64, u64)> = Vec::new();
    for n in sorted {
        match runs.last_mut() {
            Some((_, end)) if *end + 1 == *n => *end = *n,
            _ => runs.push((*n, *n)),
        }
    }
    runs.iter()
        .map(|(start, end)| if start == end { format!("e{start}") } else { format!("e{start}-e{end}") })
        .collect::<Vec<_>>()
        .join(", ")
}
