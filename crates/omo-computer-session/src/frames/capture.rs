//! `capture` / `screenshot`: the display identity read before and after, the backend capture
//! (the pointer in the frame by default, `cursor:false` for a pointer-free frame, the
//! `crosshair` falsifier drawn at the received point), the frame record, then the byte ladder
//! PNG -> JPEG -> artifact.

use omo_computer_core::backend::{CaptureOptions, FrameBytes, Refusal, Target};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::frame::{
    ladder, DisplaySelector, FrameGeometry, NoJpeg, INLINE_BUDGET_BYTES,
};
use omo_computer_core::observation::CursorMode;
use omo_computer_core::params::{CaptureParams, Point, ReportMode};
use omo_computer_core::requests::{read_capture, ReadRequest};
use omo_computer_core::results::CaptureReply;

use crate::{Session, NOT_OPEN};

/// Wayland frames carry no logical geometry until the input regions prove the scale.
const PIXELS_ONLY_REASON: &str = "no_logical_geometry";

/// One capture as the session recorded it.
#[derive(Debug, Clone, PartialEq)]
pub struct CapturedFrame {
    pub frame_id: String,
    pub target: String,
    pub geometry: FrameGeometry,
    pub bytes: FrameBytes,
    pub cursor: CursorMode,
    /// How the pixels were produced, when the backend reported it (row 47).
    pub route: Option<CaptureRoute>,
    /// `Some(true)` when windows covering the target may show in the pixels (row 47).
    pub occluders_visible: Option<bool>,
}

impl Session {
    /// `capture`: one frame of `target` (a window id, `desktop`, or `display:active|all|<id>`).
    ///
    /// # Errors
    /// `Closed` with no open session, the backend's capture refusal, `WindowNotFound`,
    /// `InvalidTarget` (no such display), `CaptureFailed{geometry_changed}`, or
    /// `CaptureFailed` when an artifact cannot be written.
    pub fn capture(&mut self, params: CaptureParams) -> Result<CaptureReply, Refusal> {
        let ReadRequest::Capture {
            target,
            caps,
            exclude_window_titles: _,
            crosshair,
            cursor,
        } = read_capture(params)
        else {
            unreachable!("read_capture always reads a capture");
        };
        let mode = self.opened.as_ref().ok_or(NOT_OPEN)?.report_mode;
        let budget = caps
            .flatten()
            .and_then(|caps| caps.max_bytes)
            .map_or(INLINE_BUDGET_BYTES, |max| max.min(INLINE_BUDGET_BYTES));
        let crosshair = crosshair.map(|at| Point { x: at.x, y: at.y });
        let frame = self.capture_frame(&target, cursor, crosshair)?;
        let delivery = ladder(frame.bytes.bytes.clone(), budget, &NoJpeg);
        self.capture_reply(mode, frame, delivery)
    }

    /// Captures `target` and records the frame; the reply is built by [`Self::capture`].
    ///
    /// # Errors
    /// As [`Self::capture`], minus the session and artifact refusals.
    pub fn capture_frame(
        &mut self,
        target: &str,
        cursor: bool,
        crosshair: Option<Point>,
    ) -> Result<CapturedFrame, Refusal> {
        self.poll_epoch();
        let epoch = self.frames.epoch();
        let mode = self
            .opened
            .as_ref()
            .map_or(ReportMode::Null, |opened| opened.report_mode);
        let options = CaptureOptions {
            cursor,
            crosshair,
            region: None,
        };
        let pixels_only = matches!(
            self.backend.capabilities().capture.route,
            Some(
                CaptureRoute::Screencast
                    | CaptureRoute::ScreencastCrop
                    | CaptureRoute::ScreenshotPortal
            )
        );
        let before = self.backend.displays().ok();
        let (bytes, geometry) = match DisplaySelector::parse(target) {
            Some(selector) => {
                let plan = self.display_plan(&selector)?;
                let source = match (&selector, plan.shown.as_slice()) {
                    (DisplaySelector::Active | DisplaySelector::Id(_), [one]) => {
                        Target::Display(one.id.clone())
                    }
                    _ => Target::Desktop,
                };
                let bytes = self.backend.capture(&source, &options)?;
                let geometry = FrameGeometry::desktop(plan.regions, plan.width, plan.height, epoch)
                    .resized_to(bytes.width, bytes.height);
                (bytes, geometry)
            }
            None => {
                // The window basis is read before the pixels, so a window replaced during the
                // capture leaves a frame of the old basis that refuses.
                let window = self.window(target);
                let bytes = self
                    .backend
                    .capture(&Target::Window(target.to_owned()), &options)?;
                let window = window.ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
                let geometry = FrameGeometry::window(
                    window.bounds,
                    window.identity,
                    bytes.width,
                    bytes.height,
                    epoch,
                );
                (bytes, geometry)
            }
        };
        if self.backend.displays().ok() != before {
            return Err(Refusal::new(
                EngineCode::CaptureFailed,
                Reason::GeometryChanged.wire(),
            ));
        }
        let geometry = if pixels_only {
            FrameGeometry::pixels_only(PIXELS_ONLY_REASON, bytes.width, bytes.height, epoch)
        } else {
            geometry
        };
        let frame_id = self.frames.record(target, geometry.clone(), mode);
        self.trace.remember_frame(target, &bytes.bytes);
        let cursor = bytes.cursor.unwrap_or(if cursor {
            CursorMode::Os
        } else {
            CursorMode::None
        });
        let (route, occluders_visible) = (bytes.route, bytes.occluders_visible);
        Ok(CapturedFrame {
            frame_id,
            target: target.to_owned(),
            geometry,
            bytes,
            cursor,
            route,
            occluders_visible,
        })
    }
}
