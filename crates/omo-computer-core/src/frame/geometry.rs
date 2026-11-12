//! `FrameGeometry`: how one frame's pixels map to desktop points. `map_point` is the only
//! transform; every scale it applies is in the frame's regions.

use super::refusal::FrameRefusal;
use crate::listing::{Rect, WindowIdentity};

/// What a frame was captured from.
#[derive(Debug, Clone, PartialEq)]
pub enum FrameKind {
    /// Displays: each region's logical rect is in desktop coordinates.
    Desktop,
    /// One window: the region's logical rect is window-relative, and a point maps through the
    /// window's CURRENT origin (a moved window re-anchors and stays valid).
    Window {
        captured_width: f64,
        captured_height: f64,
        /// `{windowNumber|hwnd|xid, pid, processStart}` at capture.
        basis: WindowIdentity,
    },
    /// The capture reported no logical geometry: the frame refuses every coordinate.
    PixelsOnly { reason: &'static str },
}

/// One rectangle of the frame: its logical rect and the pixels that show it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameRegion {
    pub logical: Rect,
    pub pixel: Rect,
}

/// The geometry of one frame.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameGeometry {
    pub kind: FrameKind,
    pub regions: Vec<FrameRegion>,
    /// The frame's size in pixels: its coordinate space.
    pub width: u32,
    pub height: u32,
    /// The session epoch the frame was captured in.
    pub epoch: u64,
}

impl FrameGeometry {
    /// Signature only at the test-first commit.
    #[must_use]
    pub fn window(
        bounds: Rect,
        basis: WindowIdentity,
        width: u32,
        height: u32,
        epoch: u64,
    ) -> Self {
        let _ = bounds;
        Self {
            kind: FrameKind::Window {
                captured_width: 0.0,
                captured_height: 0.0,
                basis,
            },
            regions: Vec::new(),
            width,
            height,
            epoch,
        }
    }

    /// Signature only at the test-first commit.
    #[must_use]
    pub const fn desktop(regions: Vec<FrameRegion>, width: u32, height: u32, epoch: u64) -> Self {
        Self {
            kind: FrameKind::Desktop,
            regions,
            width,
            height,
            epoch,
        }
    }

    /// Signature only at the test-first commit.
    #[must_use]
    pub const fn pixels_only(reason: &'static str, width: u32, height: u32, epoch: u64) -> Self {
        Self {
            kind: FrameKind::PixelsOnly { reason },
            regions: Vec::new(),
            width,
            height,
            epoch,
        }
    }

    /// Signature only at the test-first commit.
    ///
    /// # Errors
    /// None yet.
    pub fn map_point(
        &self,
        x: f64,
        y: f64,
        current: Option<&Rect>,
    ) -> Result<(f64, f64), FrameRefusal> {
        let _ = current;
        Ok((x, y))
    }

    /// Signature only at the test-first commit.
    #[must_use]
    pub fn unmap_point(&self, x: f64, y: f64, current: Option<&Rect>) -> Option<(f64, f64)> {
        let _ = current;
        Some((x, y))
    }
}
