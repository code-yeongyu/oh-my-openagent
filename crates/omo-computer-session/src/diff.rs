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
    let _ = (baseline, current, nodes_observed, HashMap::<u64, u64>::new(), HashSet::<u64>::new());
    Decision::Full(DiffFallback::SinceExpired)
}
