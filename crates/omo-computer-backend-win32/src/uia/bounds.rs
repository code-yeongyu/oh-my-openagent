//! The UIA walk's bounds (d-windows.md '## Accessibility', Batched reads): 50 raw depth and 10,000
//! siblings per parent, a web wrapper node consuming raw depth but not logical depth; and the roles
//! a coordinate click may target, because their action does not depend on where they are hit.

/// The deepest raw level the walk visits.
pub const MAX_RAW_DEPTH: usize = 50;
/// The most children read under one parent.
pub const MAX_SIBLINGS: usize = 10_000;

/// Depth counters of one walk path.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Walk {
    raw: usize,
    logical: usize,
}

impl Walk {
    /// Steps one level down; `false` when that level is past [`MAX_RAW_DEPTH`].
    pub fn descend(&mut self, web_wrapper: bool) -> bool {
        if self.raw >= MAX_RAW_DEPTH {
            return false;
        }
        self.raw += 1;
        if !web_wrapper {
            self.logical += 1;
        }
        true
    }

    /// Whether the child at zero-based `index` under one parent is read.
    #[must_use]
    pub const fn sibling_allowed(&self, index: usize) -> bool {
        index < MAX_SIBLINGS
    }

    #[must_use]
    pub const fn raw(&self) -> usize {
        self.raw
    }

    #[must_use]
    pub const fn logical(&self) -> usize {
        self.logical
    }
}

const POSITION_INDEPENDENT: [&str; 6] = [
    "Button",
    "MenuItem",
    "Hyperlink",
    "CheckBox",
    "RadioButton",
    "TabItem",
];

/// Whether a coordinate click may target an element of UIA control type `role`.
#[must_use]
pub fn coordinate_click_allowed(role: &str) -> bool {
    POSITION_INDEPENDENT.contains(&role)
}
