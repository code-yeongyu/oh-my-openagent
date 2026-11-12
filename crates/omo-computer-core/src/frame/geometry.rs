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

impl FrameRegion {
    fn holds_pixel(&self, x: f64, y: f64) -> bool {
        x >= self.pixel.x
            && y >= self.pixel.y
            && x < self.pixel.x + self.pixel.width
            && y < self.pixel.y + self.pixel.height
    }

    fn holds_logical(&self, x: f64, y: f64) -> bool {
        x >= self.logical.x
            && y >= self.logical.y
            && x < self.logical.x + self.logical.width
            && y < self.logical.y + self.logical.height
    }
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

/// Sizes within half a logical unit are the same size.
const SIZE_TOLERANCE: f64 = 0.5;

impl FrameGeometry {
    /// A window frame of `width x height` pixels showing `bounds`.
    #[must_use]
    pub fn window(
        bounds: Rect,
        basis: WindowIdentity,
        width: u32,
        height: u32,
        epoch: u64,
    ) -> Self {
        let region = FrameRegion {
            logical: Rect {
                x: 0.0,
                y: 0.0,
                width: bounds.width,
                height: bounds.height,
            },
            pixel: Rect {
                x: 0.0,
                y: 0.0,
                width: f64::from(width),
                height: f64::from(height),
            },
        };
        Self {
            kind: FrameKind::Window {
                captured_width: bounds.width,
                captured_height: bounds.height,
                basis,
            },
            regions: vec![region],
            width,
            height,
            epoch,
        }
    }

    /// A display or composite frame over `regions` (pixel rects within `width x height`).
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

    /// A frame with pixels and no logical geometry.
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

    /// The window identity of a window frame.
    #[must_use]
    pub const fn basis(&self) -> Option<&WindowIdentity> {
        match &self.kind {
            FrameKind::Window { basis, .. } => Some(basis),
            FrameKind::Desktop | FrameKind::PixelsOnly { .. } => None,
        }
    }

    /// Pixels per logical unit of the first region (1 when the frame has none).
    #[must_use]
    pub fn scale(&self) -> f64 {
        self.regions
            .first()
            .filter(|region| region.logical.width > 0.0)
            .map_or(1.0, |region| region.pixel.width / region.logical.width)
    }

    /// The desktop point the frame pixel `(x, y)` shows. `current` is the window's bounds now
    /// (window frames only).
    ///
    /// # Errors
    /// `Resized` (a window frame whose window changed size, or with no current bounds),
    /// `PixelsOnly`, or `OutsideFrame` (outside `width x height`, or between regions).
    pub fn map_point(
        &self,
        x: f64,
        y: f64,
        current: Option<&Rect>,
    ) -> Result<(f64, f64), FrameRefusal> {
        let origin = match &self.kind {
            FrameKind::PixelsOnly { .. } => return Err(FrameRefusal::PixelsOnly),
            FrameKind::Window {
                captured_width,
                captured_height,
                ..
            } => {
                let now = current.ok_or(FrameRefusal::Resized)?;
                if (now.width - captured_width).abs() > SIZE_TOLERANCE
                    || (now.height - captured_height).abs() > SIZE_TOLERANCE
                {
                    return Err(FrameRefusal::Resized);
                }
                Some((now.x, now.y))
            }
            FrameKind::Desktop => None,
        };
        let inside = x.is_finite()
            && y.is_finite()
            && x >= 0.0
            && y >= 0.0
            && x < f64::from(self.width)
            && y < f64::from(self.height);
        if !inside {
            return Err(FrameRefusal::OutsideFrame);
        }
        let region = self
            .regions
            .iter()
            .find(|region| region.holds_pixel(x, y))
            .ok_or(FrameRefusal::OutsideFrame)?;
        let local_x =
            region.logical.x + (x - region.pixel.x) * region.logical.width / region.pixel.width;
        let local_y =
            region.logical.y + (y - region.pixel.y) * region.logical.height / region.pixel.height;
        Ok(match origin {
            Some((origin_x, origin_y)) => (origin_x + local_x, origin_y + local_y),
            None => (local_x, local_y),
        })
    }

    /// The frame pixel that shows the desktop point `(x, y)`, the inverse of [`Self::map_point`];
    /// `None` on a pixels-only frame or a point no region shows.
    #[must_use]
    pub fn unmap_point(&self, x: f64, y: f64, current: Option<&Rect>) -> Option<(f64, f64)> {
        let (local_x, local_y) = match &self.kind {
            FrameKind::PixelsOnly { .. } => return None,
            FrameKind::Window { .. } => {
                let now = current?;
                (x - now.x, y - now.y)
            }
            FrameKind::Desktop => (x, y),
        };
        let region = self
            .regions
            .iter()
            .find(|region| region.holds_logical(local_x, local_y))?;
        Some((
            region.pixel.x
                + (local_x - region.logical.x) * region.pixel.width / region.logical.width,
            region.pixel.y
                + (local_y - region.logical.y) * region.pixel.height / region.logical.height,
        ))
    }

    /// The regions re-expressed in a frame of `width x height` pixels (the backend answered
    /// another size than planned): every scale stays in the record.
    #[must_use]
    pub fn resized_to(mut self, width: u32, height: u32) -> Self {
        if self.width > 0 && self.height > 0 && (width, height) != (self.width, self.height) {
            let ratio_x = f64::from(width) / f64::from(self.width);
            let ratio_y = f64::from(height) / f64::from(self.height);
            for region in &mut self.regions {
                region.pixel.x *= ratio_x;
                region.pixel.width *= ratio_x;
                region.pixel.y *= ratio_y;
                region.pixel.height *= ratio_y;
            }
        }
        self.width = width;
        self.height = height;
        self
    }
}
