//! `display(active|all|<id>)`: which displays a capture shows and the composite they form.
//! The composite is drawn at the highest scale of its displays, holds at most 16 displays and
//! `MAX_COMPOSITE_PIXELS` pixels, and names every display it dropped.

use super::geometry::FrameRegion;
use crate::listing::Rect;
use crate::results::DisplayInfo;

/// The most pixels one composite may hold (268,435,456).
pub const MAX_COMPOSITE_PIXELS: u64 = 268_435_456;
/// The most displays one composite may hold.
pub const MAX_COMPOSITE_DISPLAYS: usize = 16;

/// Which displays a display capture shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DisplaySelector {
    /// The display the focused window covers most (the primary when no window is focused).
    Active,
    /// Every display.
    All,
    /// One display by id.
    Id(String),
}

/// The planned composite.
#[derive(Debug, Clone, PartialEq)]
pub struct Composite {
    /// The displays drawn, in listing order.
    pub shown: Vec<DisplayInfo>,
    /// The ids of the displays left out.
    pub dropped: Vec<String>,
    pub scale: f64,
    pub width: u32,
    pub height: u32,
    pub regions: Vec<FrameRegion>,
}

/// Signature only at the test-first commit.
#[must_use]
pub fn composite(
    displays: &[DisplayInfo],
    selector: &DisplaySelector,
    focused: Option<&Rect>,
) -> Option<Composite> {
    let _ = (displays, selector, focused);
    None
}
