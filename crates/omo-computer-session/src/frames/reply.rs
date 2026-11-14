//! The reply a capture answers: the frame inline (base64 PNG or JPEG) when it fits the
//! budget, else a PNG artifact in the session's own artifact dir, in the session's report
//! mode.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;
use omo_computer_core::frame::Delivery;
use omo_computer_core::observation::{Frame, FrameArtifact, ImageMime};
use omo_computer_core::params::ReportMode;
use omo_computer_core::results::{CaptureMode, CaptureReply, LegacyFrame};
use omo_computer_core::untrusted::UntrustedText;
use sha2::{Digest, Sha256};

use super::CapturedFrame;
use crate::Session;

/// How long an artifact frame stays readable before the age sweep may remove it (12 h).
pub const ARTIFACT_TTL_MS: u64 = 43_200_000;

/// What an artifact-only frame tells the model.
const OVER_BUDGET_NOTE: &str = "over the inline budget";

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

    pub(super) fn capture_reply(
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
