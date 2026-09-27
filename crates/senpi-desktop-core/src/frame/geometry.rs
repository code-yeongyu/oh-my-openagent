use super::round_to_u32;
use crate::error::{CoreResult, DesktopError};
use crate::types::{DesktopDisplay, DesktopWindow};

#[derive(Debug, Clone, PartialEq)]
struct FrameRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    pixel_x: f64,
    pixel_y: f64,
    pixel_width: f64,
    pixel_height: f64,
}

impl FrameRegion {
    fn contains_pixel(&self, x: f64, y: f64) -> bool {
        x >= self.pixel_x
            && x < self.pixel_x + self.pixel_width
            && y >= self.pixel_y
            && y < self.pixel_y + self.pixel_height
    }

    fn contains_logical(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Debug, Clone, PartialEq)]
enum FrameKind {
    Desktop,
    Window {
        captured_width: u32,
        captured_height: u32,
    },
    Identity,
}

/// The pixel <-> logical mapping of one capture of one target.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameGeometry {
    width: u32,
    height: u32,
    regions: Vec<FrameRegion>,
    kind: FrameKind,
}

impl FrameGeometry {
    pub fn for_displays(displays: &[DesktopDisplay]) -> Self {
        let width = displays
            .iter()
            .map(|d| d.pixel_x.saturating_add(d.pixel_width))
            .max()
            .unwrap_or(0);
        let height = displays
            .iter()
            .map(|d| d.pixel_y.saturating_add(d.pixel_height))
            .max()
            .unwrap_or(0);
        let regions = displays
            .iter()
            .map(|d| FrameRegion {
                x: f64::from(d.x),
                y: f64::from(d.y),
                width: f64::from(d.width),
                height: f64::from(d.height),
                pixel_x: f64::from(d.pixel_x),
                pixel_y: f64::from(d.pixel_y),
                pixel_width: f64::from(d.pixel_width),
                pixel_height: f64::from(d.pixel_height),
            })
            .collect();
        Self {
            width,
            height,
            regions,
            kind: FrameKind::Desktop,
        }
    }

    pub fn for_window(window: &DesktopWindow, px_width: u32, px_height: u32) -> Self {
        Self {
            width: px_width,
            height: px_height,
            regions: vec![FrameRegion {
                x: f64::from(window.x),
                y: f64::from(window.y),
                width: f64::from(window.width),
                height: f64::from(window.height),
                pixel_x: 0.0,
                pixel_y: 0.0,
                pixel_width: f64::from(px_width),
                pixel_height: f64::from(px_height),
            }],
            kind: FrameKind::Window {
                captured_width: window.width,
                captured_height: window.height,
            },
        }
    }

    /// Frame for input addressed in global logical coordinates (AX clicks).
    pub const fn identity_global() -> Self {
        Self {
            width: u32::MAX,
            height: u32::MAX,
            regions: Vec::new(),
            kind: FrameKind::Identity,
        }
    }

    /// Maps a capture pixel to a global logical desktop point. Window frames
    /// re-anchor on the window's current origin and reject a resized window.
    pub fn map_point(
        &self,
        x: f64,
        y: f64,
        current_window: Option<&DesktopWindow>,
    ) -> CoreResult<(f64, f64)> {
        if !x.is_finite()
            || !y.is_finite()
            || x < 0.0
            || y < 0.0
            || x >= f64::from(self.width)
            || y >= f64::from(self.height)
        {
            return Err(DesktopError::invalid_coordinate_frame(format!(
                "coordinate ({x}, {y}) is outside the last capture frame ({}x{} px); pointer/hit-test \
                 coordinates are pixels in the most recent screenshot of this target",
                self.width, self.height
            )));
        }
        if self.kind == FrameKind::Identity {
            return Ok((x, y));
        }
        let region = self
            .regions
            .iter()
            .find(|r| r.contains_pixel(x, y))
            .ok_or_else(|| {
                DesktopError::invalid_coordinate_frame(format!(
                    "capture coordinate ({x}, {y}) falls between display regions; pick a point inside \
                 one display"
                ))
            })?;
        let local_x = (x - region.pixel_x) * region.width / region.pixel_width;
        let local_y = (y - region.pixel_y) * region.height / region.pixel_height;
        match self.kind {
            FrameKind::Window {
                captured_width,
                captured_height,
            } => {
                let current = current_window
                    .ok_or_else(|| DesktopError::window_not_found("target window is no longer available"))?;
                if current.width != captured_width || current.height != captured_height {
                    return Err(DesktopError::invalid_coordinate_frame(
                        "target window was resized since capture; capture it again before coordinate \
                         input",
                    ));
                }
                Ok((f64::from(current.x) + local_x, f64::from(current.y) + local_y))
            }
            FrameKind::Desktop => Ok((region.x + local_x, region.y + local_y)),
            FrameKind::Identity => Ok((x, y)),
        }
    }

    /// Inverse of `map_point` at capture time: expresses a global logical
    /// point (e.g. AX bounds) as a pixel of this frame.
    pub fn map_to_pixel(&self, x: f64, y: f64) -> CoreResult<(f64, f64)> {
        if self.kind == FrameKind::Identity {
            return Ok((x, y));
        }
        let region = self
            .regions
            .iter()
            .find(|r| r.contains_logical(x, y))
            .ok_or_else(|| {
                DesktopError::invalid_coordinate_frame(format!(
                    "desktop point ({x}, {y}) is outside every region of the last capture frame"
                ))
            })?;
        Ok((
            region.pixel_x + (x - region.x) * region.pixel_width / region.width,
            region.pixel_y + (y - region.y) * region.pixel_height / region.height,
        ))
    }

    pub(super) fn scaled(&mut self, ratio_x: f64, ratio_y: f64, width: u32, height: u32) {
        for region in &mut self.regions {
            region.pixel_x *= ratio_x;
            region.pixel_width *= ratio_x;
            region.pixel_y *= ratio_y;
            region.pixel_height *= ratio_y;
        }
        self.width = width;
        self.height = height;
    }

    /// `source` displays re-expressed in this (possibly scaled) frame's pixels.
    pub fn display_metadata(&self, source: &[DesktopDisplay]) -> Vec<DesktopDisplay> {
        source
            .iter()
            .zip(&self.regions)
            .map(|(display, region)| DesktopDisplay {
                pixel_x: round_to_u32(region.pixel_x),
                pixel_y: round_to_u32(region.pixel_y),
                pixel_width: round_to_u32(region.pixel_width).max(1),
                pixel_height: round_to_u32(region.pixel_height).max(1),
                ..display.clone()
            })
            .collect()
    }
}
