//! The screenshot budget: dimension caps (the host's, clamped to 1280x896
//! when coordinate-safe), then the inline byte budget PNG -> JPEG q70 ->
//! artifact-only. Every degradation carries a note for the model.

mod encode;
mod plan;
#[cfg(test)]
mod tests;

use std::path::PathBuf;

use senpi_desktop_core::types::CaptureMode;

pub(crate) use plan::{plan_screenshot, Budget};

/// How the capture reaches the model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Delivery {
    InlinePng(Vec<u8>),
    InlineJpeg {
        jpeg: Vec<u8>,
        note: String,
    },
    /// The full-resolution PNG, saved because no inline form fit the budget.
    ArtifactOnly {
        path: PathBuf,
        note: String,
    },
}

impl Delivery {
    pub(crate) const fn mode(&self) -> CaptureMode {
        match self {
            Self::InlinePng(_) => CaptureMode::InlinePng,
            Self::InlineJpeg { .. } => CaptureMode::InlineJpeg,
            Self::ArtifactOnly { .. } => CaptureMode::ArtifactOnly,
        }
    }
}

/// A budgeted screenshot and its metadata. `width`/`height` are the capped
/// frame the pointer coordinates address; `source_*` the captured image.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ScreenshotResult {
    pub(crate) delivery: Delivery,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) source_width: u32,
    pub(crate) source_height: u32,
}

impl ScreenshotResult {
    /// Capped frame pixels per source pixel.
    pub(crate) fn scale(&self) -> f64 {
        f64::from(self.width) / f64::from(self.source_width)
    }
}
