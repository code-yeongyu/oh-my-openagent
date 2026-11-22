//! The observation model: what a bounded accessibility walk reads, the outline grammar the
//! model reads, the ref token that names an element back, and the diff-fallback reasons.
//! The registry that mints and resolves refs lives in the session crate; this module holds
//! the shapes and the walk every backend's reader feeds.

mod node;
mod outline;
mod token;
mod walk;

#[cfg(test)]
mod tests;

pub use node::{AxHandle, Evidence, NativeObject, NodeRead, RootRead, Seen, WindowKey};
pub use outline::{label, line, root_suffix, LineStyle, LABEL_CHARS};
pub use token::RefToken;
pub use walk::{is_wrapper, walk, AxReader, Limits, Slice, Walk, WalkNode};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Generations of one window whose refs still act; the ninth observe expires the oldest.
pub const GENERATIONS_PER_WINDOW: usize = 8;

/// Retained element objects across one session before the least recently used generation is
/// pruned.
pub const RETAINED_OBJECTS: usize = 65_536;

/// The walk's deadline from the request.
pub const DEADLINE_MS: u64 = 3_000;

/// The longest one read IPC may take; a control that does not answer inside it is `unknown`.
pub const SLICE_MS: u64 = 250;

/// Nodes one read observes at most.
pub const NODE_BUDGET: u32 = 2_000;

/// The logical depth a full read descends to.
pub const MAX_LOGICAL_DEPTH: u32 = 24;

/// The logical depth the default (skeleton) rendering shows.
pub const SKELETON_DEPTH: u32 = 3;

/// Why an `observe({since})` answered the full tree instead of a diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiffFallback {
    /// `since` names no generation in the window's 8-generation window.
    SinceExpired,
    BaselineIncomplete,
    CurrentIncomplete,
    /// The window identity (pid, process start, window) changed since the baseline.
    WindowChanged,
    /// The baseline or the current root is an open menu.
    MenuRoot,
    /// The surviving elements changed their relative order.
    Reordered,
    /// The diff text is not shorter than the full tree text.
    NotShorter,
    /// A `query` projection keeps its own baseline and never diffs.
    QueryProjection,
}
