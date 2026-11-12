//! `capture`. Signatures only at the test-first commit.

use omo_computer_core::backend::{FrameBytes, Refusal};
use omo_computer_core::error::EngineCode;
use omo_computer_core::frame::FrameGeometry;
use omo_computer_core::observation::{CursorMode, ImageMime};
use omo_computer_core::params::{CaptureParams, Point};
use omo_computer_core::results::CaptureReply;

use crate::Session;

/// How long an artifact frame stays readable before the age sweep may remove it (12 h).
pub const ARTIFACT_TTL_MS: u64 = 43_200_000;

/// One capture as the session recorded it.
#[derive(Debug, Clone, PartialEq)]
pub struct CapturedFrame {
    pub frame_id: String,
    pub target: String,
    pub geometry: FrameGeometry,
    pub bytes: FrameBytes,
    pub cursor: CursorMode,
}

impl Session {
    /// Signature only at the test-first commit.
    ///
    /// # Errors
    /// Always, at this commit.
    pub fn capture(&mut self, params: CaptureParams) -> Result<CaptureReply, Refusal> {
        let _ = params;
        Err(Refusal::bare(EngineCode::CaptureFailed))
    }

    /// Signature only at the test-first commit.
    ///
    /// # Errors
    /// None at this commit.
    pub fn capture_frame(
        &mut self,
        target: &str,
        cursor: bool,
        crosshair: Option<Point>,
    ) -> Result<CapturedFrame, Refusal> {
        let _ = (cursor, crosshair);
        Ok(CapturedFrame {
            frame_id: String::new(),
            target: target.to_owned(),
            geometry: FrameGeometry::pixels_only("", 0, 0, 0),
            bytes: FrameBytes {
                width: 0,
                height: 0,
                mime: ImageMime::Png,
                bytes: Vec::new(),
            },
            cursor: CursorMode::None,
        })
    }
}
