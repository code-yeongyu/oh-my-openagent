//! Capture: the scripted gray frame, its pixel cap, and the pointer and crosshair drawn on it.

use omo_computer_core::backend::{BackendResult, CaptureOptions, FrameBytes, Refusal, Target};
use omo_computer_core::error::EngineCode;
use omo_computer_core::observation::ImageMime;

use super::geometry::capture_rect;
use crate::backend::FakeBackend;
use crate::frame::{pixels, Raster};
use crate::method::FakeMethod;

/// The most pixels one capture may hold: the composite cap of the design's
/// `d-vision.md` '## Screenshot pipeline' (`MAX_COMPOSITE_PIXELS` = 268,435,456). Row 12's
/// limits table carries no pixel cap, so the fake names it here; the frame row owns the
/// engine's own copy.
pub const MAX_COMPOSITE_PIXELS: u64 = 268_435_456;

impl FakeBackend {
    pub(super) fn capture_frame(
        &mut self,
        target: &Target,
        options: &CaptureOptions,
    ) -> BackendResult<FrameBytes> {
        self.call(FakeMethod::Capture, |state, _| {
            let (rect, scale) = capture_rect(state, target)?;
            let rect = options.region.unwrap_or(rect);
            // A scale that is not positive, or a negative size, refuses before the multiply:
            // two negatives would otherwise make a positive extent.
            if scale.is_nan() || scale <= 0.0 || rect.width < 0.0 || rect.height < 0.0 {
                return Err(Refusal::bare(EngineCode::CaptureFailed));
            }
            let (scaled_width, scaled_height) = (rect.width * scale, rect.height * scale);
            // `pixels` truncates to whole pixels and maps a non-finite length to 0, so a
            // non-finite extent refuses here and any length under 1 px refuses as 0 below.
            if !scaled_width.is_finite() || !scaled_height.is_finite() {
                return Err(Refusal::bare(EngineCode::CaptureFailed));
            }
            let (width, height) = (pixels(scaled_width), pixels(scaled_height));
            if width == 0
                || height == 0
                || u64::from(width) * u64::from(height) > MAX_COMPOSITE_PIXELS
            {
                return Err(Refusal::bare(EngineCode::CaptureFailed));
            }
            let gray = if state.scenario.legacy_capture {
                0x60
            } else {
                0xA0
            };
            let mut raster = Raster::filled(width, height, gray);
            // The pointer is in the frame by default (`cursor:false` leaves it out), drawn at
            // the cursor's native pixel; the crosshair is drawn at the frame point it names.
            if let Some(cursor) = state.cursor.filter(|_| options.cursor) {
                raster.pointer((cursor.x - rect.x) * scale, (cursor.y - rect.y) * scale);
            }
            if let Some(at) = options.crosshair {
                raster.crosshair(at.x, at.y);
            }
            Ok(FrameBytes {
                width,
                height,
                mime: ImageMime::Png,
                bytes: raster.png(),
            })
        })
    }
}
