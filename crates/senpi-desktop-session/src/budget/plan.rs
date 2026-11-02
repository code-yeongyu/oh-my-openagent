//! Resolving the effective caps and choosing the inline form.

use std::path::PathBuf;

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::{apply_capture_caps, FrameGeometry};
use senpi_desktop_core::types::CaptureCaps;

use super::encode::{format_bytes, jpeg, png, write_artifact, JPEG_QUALITY};
use super::{Delivery, ScreenshotResult};

/// Host caps when `session.open` names no size: senpi's own default, not a
/// provider limit.
pub(crate) const DEFAULT_MAX_WIDTH: u32 = 3840;
pub(crate) const DEFAULT_MAX_HEIGHT: u32 = 2400;
/// The largest frame whose pixels models that cannot see `detail: original`
/// still click accurately in (oh-my-pi `computer.ts`).
pub(crate) const COORDINATE_SAFE_MAX_WIDTH: u32 = 1280;
pub(crate) const COORDINATE_SAFE_MAX_HEIGHT: u32 = 896;

/// The effective caps of one capture and where an artifact-only capture goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Budget {
    /// `max_width`/`max_height` are always `Some`.
    caps: CaptureCaps,
    artifact_dir: PathBuf,
}

impl Budget {
    /// Resolves the session's caps with the call's. A call may only tighten
    /// them: model code must not undo the host's coordinate-safe clamp or
    /// raise the provider byte budget.
    ///
    /// # Errors
    /// `InvalidTarget` for a zero byte budget.
    pub(crate) fn new(
        session: &CaptureCaps,
        call: Option<&CaptureCaps>,
        artifact_dir: PathBuf,
    ) -> CoreResult<Self> {
        let call = call.unwrap_or(session);
        let max_bytes = session.max_bytes.min(call.max_bytes);
        if max_bytes == 0 {
            return Err(DesktopError::invalid_target(
                "capture caps maxBytes must be greater than zero",
            ));
        }
        let coordinate_safe = session.coordinate_safe || call.coordinate_safe;
        let tighter = |host: Option<u32>, requested: Option<u32>, default: u32| {
            host.unwrap_or(default).min(requested.unwrap_or(u32::MAX))
        };
        let clamp = |limit: u32, safe: u32| Some(if coordinate_safe { limit.min(safe) } else { limit });
        let caps = CaptureCaps {
            max_width: clamp(
                tighter(session.max_width, call.max_width, DEFAULT_MAX_WIDTH),
                COORDINATE_SAFE_MAX_WIDTH,
            ),
            max_height: clamp(
                tighter(session.max_height, call.max_height, DEFAULT_MAX_HEIGHT),
                COORDINATE_SAFE_MAX_HEIGHT,
            ),
            coordinate_safe,
            max_bytes,
        };
        Ok(Self { caps, artifact_dir })
    }

    /// The resolved caps, as handed to the backend.
    pub(crate) const fn caps(&self) -> &CaptureCaps {
        &self.caps
    }
}

/// Caps `source` (rescaling `geometry` to match), then delivers the first
/// form that fits the byte budget: capped PNG, capped JPEG, else the
/// full-resolution PNG saved as an artifact.
///
/// # Errors
/// `InvalidTarget` for zero caps, `CaptureFailed` for an empty or oversized
/// image, or when an encoder or the artifact write fails.
pub(crate) fn plan_screenshot(
    source: RgbaImage,
    geometry: &mut FrameGeometry,
    budget: &Budget,
) -> CoreResult<ScreenshotResult> {
    let (source_width, source_height) = source.dimensions();
    // The source outlives the resize: artifact-only saves it at full size.
    let capped = apply_capture_caps(source.clone(), geometry, &budget.caps)?;
    let (width, height) = capped.dimensions();
    let max_bytes = budget.caps.max_bytes;
    let fits = |bytes: &[u8]| u64::try_from(bytes.len()).is_ok_and(|len| len <= max_bytes);
    let result = |delivery| ScreenshotResult {
        delivery,
        width,
        height,
        source_width,
        source_height,
    };
    let resized = (width, height) != (source_width, source_height);
    let capped_png = png(&capped)?;
    if fits(&capped_png) {
        return Ok(result(Delivery::InlinePng(capped_png)));
    }
    let jpeg = jpeg(&capped)?;
    if fits(&jpeg) {
        let note = format!(
            "Inline screenshot re-encoded as JPEG (quality {JPEG_QUALITY}) because the PNG exceeded {}.",
            format_bytes(max_bytes)
        );
        return Ok(result(Delivery::InlineJpeg { jpeg, note }));
    }
    let full_png = if resized { png(&source)? } else { capped_png };
    let path = write_artifact(&budget.artifact_dir, &full_png)?;
    let mut note = format!(
        "Inline screenshot omitted because it could not be bounded below {}; use the saved screenshot \
         artifact instead.",
        format_bytes(max_bytes)
    );
    if resized {
        note.push_str(&format!(
            " The artifact is {source_width}x{source_height} px; pointer coordinates address the \
             {width}x{height} frame, so scale artifact pixels by {width}/{source_width}."
        ));
    }
    Ok(result(Delivery::ArtifactOnly { path, note }))
}
