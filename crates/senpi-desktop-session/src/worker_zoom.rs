//! Fresh native-detail zoom; the full input frame remains session-owned.

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::protocol_params::CaptureRegionParams;
use senpi_desktop_core::types::{CaptureCaps, Target};

use crate::budget::{plan_screenshot, Delivery};
use crate::request::Response;
use crate::worker::Worker;
use crate::worker_capture::capture_response;

impl Worker {
    pub(crate) fn capture_region(
        &mut self,
        params: &CaptureRegionParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Response> {
        let target = Target::parse(&params.target);
        let base = self.frames.latest(&target, params.frame_id.as_deref())?;
        base.validate_region(&params.region)?;
        self.validate_zoom_target(&base, &target)?;
        let budget = self.capture_budget(params.caps.as_ref())?;
        check_cancel(cancelled)?;
        let pinned = base.capture_target(&target);
        let (image, fresh) = self.backend()?.capture(&pinned, &CaptureCaps::default(), &[])?;
        let legacy_capture = fresh.is_legacy_capture();
        self.validate_zoom_target(&base, &target)?;
        let image = base.crop_region(image, &fresh, &params.region)?;
        let (width, height) = image.dimensions();
        let mut geometry =
            FrameGeometry::pixels_only(width, height, "zoom pixels are not input coordinates");
        check_cancel(cancelled)?;
        let mut screenshot = plan_screenshot(image, &mut geometry, &budget)?;
        if let Delivery::ArtifactOnly { note, .. } = &mut screenshot.delivery {
            let (width, height) = base.dimensions();
            *note = format!(
                "Zoom exceeds the inline byte budget; the artifact contains native crop pixels. \
                 Input coordinates remain in the last full screenshot ({width}x{height})."
            );
        }
        check_cancel(cancelled)?;
        let frame_id = self
            .frames
            .latest_id(target.key())
            .ok_or_else(|| DesktopError::invalid_coordinate_frame("full screenshot is missing"))?
            .to_owned();
        self.refresh_capabilities();
        Ok(capture_response(
            screenshot,
            &target,
            frame_id,
            Some((params.region, base.dimensions())),
            None,
            legacy_capture,
        ))
    }

    fn validate_zoom_target(&mut self, base: &FrameGeometry, target: &Target) -> CoreResult<()> {
        match target {
            Target::Window(_) => {
                let window = self.window(target).map_err(|error| {
                    DesktopError::invalid_coordinate_frame(format!(
                        "cannot validate zoom window: {error}"
                    ))
                })?;
                base.validate_zoom_layout(&[], Some(&window))
            }
            Target::Desktop | Target::Display(_) => {
                let displays = self.backend()?.displays().map_err(|error| {
                    DesktopError::invalid_coordinate_frame(format!(
                        "cannot validate zoom layout: {error}"
                    ))
                })?;
                base.validate_zoom_layout(&displays, None)
            }
        }
    }
}

fn check_cancel(cancelled: &dyn Fn() -> bool) -> CoreResult<()> {
    if cancelled() {
        Err(DesktopError::new(
            ErrorCode::Cancelled,
            "zoom was cancelled",
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests;
