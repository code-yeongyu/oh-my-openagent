//! `capture` / `screenshot`: the display identity read before and after, the backend capture
//! (the pointer in the frame by default, `cursor:false` for a pointer-free frame, the
//! `crosshair` falsifier drawn at the received point), the frame record, then the byte ladder
//! PNG -> JPEG -> artifact.

use omo_computer_core::backend::{CaptureOptions, FrameBytes, Refusal, Target};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::frame::{
    ladder, Delivery, DisplaySelector, FrameGeometry, NoJpeg, INLINE_BUDGET_BYTES,
};
use omo_computer_core::observation::{CursorMode, Frame, FrameArtifact, ImageMime};
use omo_computer_core::params::{CaptureParams, Point, ReportMode};
use omo_computer_core::requests::{read_capture, ReadRequest};
use omo_computer_core::results::{CaptureMode, CaptureReply, LegacyFrame};
use omo_computer_core::untrusted::UntrustedText;
use sha2::{Digest, Sha256};

use crate::{Session, NOT_OPEN};

/// How long an artifact frame stays readable before the age sweep may remove it (12 h).
pub const ARTIFACT_TTL_MS: u64 = 43_200_000;

/// What an artifact-only frame tells the model.
const OVER_BUDGET_NOTE: &str = "over the inline budget";

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
}

/// An artifact written for a frame over the inline budget.
struct Written {
    path: String,
    digest: String,
    size: u64,
}

const fn mime_wire(mime: ImageMime) -> &'static str {
    match mime {
        ImageMime::Png => "image/png",
        ImageMime::Jpeg => "image/jpeg",
    }
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// RFC 4648 base64 with padding.
fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let symbols = [
            b0 >> 2,
            ((b0 & 0x03) << 4) | (b1 >> 4),
            ((b1 & 0x0f) << 2) | (b2 >> 6),
            b2 & 0x3f,
        ];
        for (index, symbol) in symbols.into_iter().enumerate() {
            if index <= chunk.len() {
                out.push(char::from(BASE64[usize::from(symbol)]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
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
        Ok(CapturedFrame {
            frame_id,
            target: target.to_owned(),
            geometry,
            bytes,
            cursor: if cursor {
                CursorMode::Os
            } else {
                CursorMode::None
            },
        })
    }

    fn write_artifact(&mut self, png: &[u8]) -> Result<Written, Refusal> {
        let digest = hex(&Sha256::digest(png));
        let now = crate::audit::now_ms();
        // Only the session's own artifact dir (under its STATE root) is written: a session
        // without one has nowhere private to put the frame, so the artifact is refused.
        let Some(store) = self.artifacts() else {
            eprintln!("omo-computer-engine: frame over the inline budget and no artifact dir");
            return Err(Refusal::bare(EngineCode::CaptureFailed));
        };
        let written = store.record(&digest, "png", png, now);
        let path = written.map_err(|error| {
            eprintln!("omo-computer-engine: frame artifact not written: {error}");
            Refusal::bare(EngineCode::CaptureFailed)
        })?;
        Ok(Written {
            path: path.to_string_lossy().into_owned(),
            digest,
            size: u64::try_from(png.len()).unwrap_or(u64::MAX),
        })
    }

    fn capture_reply(
        &mut self,
        mode: ReportMode,
        frame: CapturedFrame,
        delivery: Delivery,
    ) -> Result<CaptureReply, Refusal> {
        let (inline, mime, written) = match delivery {
            Delivery::InlinePng(png) => (Some(png), ImageMime::Png, None),
            Delivery::InlineJpeg(jpeg) => (Some(jpeg), ImageMime::Jpeg, None),
            Delivery::Artifact(png) => (None, ImageMime::Png, Some(self.write_artifact(&png)?)),
        };
        let CapturedFrame {
            frame_id,
            target,
            bytes,
            cursor,
            ..
        } = frame;
        let (width, height) = (bytes.width, bytes.height);
        Ok(match mode {
            ReportMode::Null => CaptureReply::Legacy(Box::new(LegacyFrame {
                mode: if written.is_some() {
                    CaptureMode::ArtifactOnly
                } else {
                    CaptureMode::InlinePng
                },
                data: inline.as_deref().map(base64),
                mime_type: mime_wire(mime).to_owned(),
                artifact_path: written.as_ref().map(|artifact| artifact.path.clone()),
                width,
                height,
                source_width: width,
                source_height: height,
                coordinate_width: width,
                coordinate_height: height,
                region: None,
                scale: 1.0,
                target,
                frame_id,
                note: written.as_ref().map(|_| OVER_BUDGET_NOTE.to_owned()),
                legacy_capture: None,
            })),
            ReportMode::Object => CaptureReply::Object(Box::new(Frame {
                frame_id,
                target,
                width,
                height,
                coordinate_width: width,
                coordinate_height: height,
                scale: 1.0,
                cursor,
                path: written.as_ref().map(|artifact| artifact.path.clone()),
                artifact: written.map(|artifact| FrameArtifact {
                    digest: artifact.digest,
                    size: artifact.size,
                    mime,
                    ttl_ms: ARTIFACT_TTL_MS,
                }),
                session: self.backend.capabilities().session,
                observation: UntrustedText,
            })),
        })
    }
}

#[cfg(test)]
mod base64_tests {
    #[test]
    fn base64_matches_rfc_4648() {
        for (input, encoded) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(super::base64(input.as_bytes()), encoded);
        }
    }
}
