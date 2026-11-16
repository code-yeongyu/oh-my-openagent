//! Lossless-or-full: a read that names `since` gets a diff only when every gate holds -
//! baseline in the window, both reads complete, same window identity, no menu root, the
//! surviving elements in their old relative order, not a `query` projection, and the diff
//! strictly shorter than the full tree. Otherwise the full tree with the failing gate's reason.
//! Nodes are keyed by element number, never by line position.
//!
//! The diff applies back to the baseline (amendment A-IS-59): `~ <line>` replaces a survivor's
//! line; added nodes come in runs of adjacent added siblings under one surviving parent, each
//! printed whole with its subtree, the run's first line marked `+(under e<p> after e<n>)` or
//! `+(under e<p> first)` (`under` left out at the root) and every other line `+ `, indented
//! from the run's first line; `removed: ...` lists what went away. A survivor whose rendered
//! parent changed is a move, and moves give the full tree as `reordered`.

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

/// The survivors, compared as sequences of element numbers, are not in their old order, or a
/// survivor's rendered parent is another element than in the baseline (a move, A-IS-59).
fn reordered(baseline: &Outline, current: &Outline) -> bool {
    let now: HashMap<u64, Option<u64>> = current.lines.iter().map(|line| (line.n, line.parent)).collect();
    let old: HashMap<u64, Option<u64>> = baseline.lines.iter().map(|line| (line.n, line.parent)).collect();
    let before = baseline.lines.iter().map(|line| line.n).filter(|n| now.contains_key(n));
    let after = current.lines.iter().map(|line| line.n).filter(|n| old.contains_key(n));
    let moved = current.lines.iter().any(|line| old.get(&line.n).is_some_and(|parent| *parent != line.parent));
    moved || !before.eq(after)
}

fn render(baseline: &Side, current: &Side, nodes_observed: u32) -> String {
    let old: HashMap<u64, &OutlineLine> = baseline.outline.lines.iter().map(|line| (line.n, line)).collect();
    let mut out: Vec<String> = Vec::new();
    let added: HashSet<u64> = current.outline.lines.iter().map(|line| line.n).filter(|n| !old.contains_key(n)).collect();
    // The run being printed: its parent and the indentation of its first line.
    let mut run: Option<(Option<u64>, usize)> = None;
    for (at, line) in current.outline.lines.iter().enumerate() {
        let body = line.text.trim_start();
        if !added.contains(&line.n) {
            run = None;
            if old.get(&line.n).is_some_and(|before| before.key != line.key) {
                out.push(format!("~ {body}"));
            }
            continue;
        }
        let inside_added = line.parent.is_some_and(|parent| added.contains(&parent));
        match run {
            // A descendant of an added node, or a further added sibling of the run.
            Some((parent, base)) if inside_added || parent == line.parent => {
                out.push(format!("+ {}{body}", "  ".repeat(line.indent.saturating_sub(base))));
            }
            _ => {
                let after = current.outline.lines[..at]
                    .iter()
                    .rev()
                    .find(|sibling| sibling.parent == line.parent && !added.contains(&sibling.n))
                    .map(|sibling| sibling.n);
                out.push(format!("+({}) {body}", place(line.parent, after)));
                run = Some((line.parent, line.indent));
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

/// A run's place: `under e<p>` (left out at the root), then `after e<n>` or `first`.
fn place(parent: Option<u64>, after: Option<u64>) -> String {
    let under = parent.map(|parent| format!("under e{parent} "));
    let after = after.map_or_else(|| "first".to_owned(), |sibling| format!("after e{sibling}"));
    format!("{}{after}", under.unwrap_or_default())
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
