//! `capture`: backend image -> screenshot budget (caps, then PNG / JPEG /
//! artifact-only), recorded as the target's latest frame.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::protocol_params::CaptureParams;
use senpi_desktop_core::types::{CaptureResult, DesktopSessionOptions, Target};

use crate::budget::{plan_screenshot, Budget, Delivery};
use crate::request::Response;
use crate::worker::Worker;

impl Worker {
    pub(crate) fn capture(&mut self, params: &CaptureParams) -> CoreResult<Response> {
        let target = Target::parse(&params.target);
        let artifact_dir = self.artifact_dir();
        let unopened = DesktopSessionOptions::default();
        let caps = self.options.as_ref().unwrap_or(&unopened).capture_caps.clone();
        let budget = Budget::new(&caps, params.caps.as_ref(), artifact_dir)?;
        let (image, mut geometry) = self.backend()?.capture(&target, budget.caps())?;
        let screenshot = plan_screenshot(image, &mut geometry, &budget)?;
        let frame_id = self.frames.record(&target, geometry);
        self.refresh_capabilities();
        let scale = screenshot.scale();
        let mode = screenshot.delivery.mode();
        let (data, mime_type, artifact_path, note) = match screenshot.delivery {
            Delivery::InlinePng(png) => (Some(base64(&png)), "image/png", None, None),
            Delivery::InlineJpeg { jpeg, note } => (Some(base64(&jpeg)), "image/jpeg", None, Some(note)),
            Delivery::ArtifactOnly { path, note } => (None, "image/png", Some(path), Some(note)),
        };
        Ok(Response::Capture(CaptureResult {
            mode,
            data,
            mime_type: Some(mime_type.to_owned()),
            artifact_path,
            width: screenshot.width,
            height: screenshot.height,
            source_width: screenshot.source_width,
            source_height: screenshot.source_height,
            scale,
            target: target.key().to_owned(),
            frame_id,
            note,
        }))
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard padded base64 (RFC 4648 section 4).
fn base64(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let [a, b, c] = [0, 1, 2].map(|index| chunk.get(index).copied().unwrap_or(0));
        let group = u32::from_be_bytes([0, a, b, c]);
        let sextets = [18, 12, 6, 0].map(|shift| char::from(ALPHABET[usize::from(sextet(group, shift))]));
        let kept = chunk.len() + 1;
        encoded.extend(sextets.iter().take(kept));
        encoded.extend(std::iter::repeat_n('=', 4 - kept));
    }
    encoded
}

/// The six bits of `group` starting at bit `shift`.
fn sextet(group: u32, shift: u32) -> u8 {
    // Masked to six bits, so the value always fits a `u8`.
    u8::try_from((group >> shift) & 0x3f).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn base64_matches_the_rfc_4648_vectors() {
        let vectors = [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ];
        for (input, expected) in vectors {
            assert_eq!(base64(input.as_bytes()), expected, "base64({input:?})");
        }
    }

    #[test]
    fn base64_uses_the_standard_alphabet_for_high_bits() {
        assert_eq!(base64(&[0xfb, 0xff, 0xbf]), "+/+/");
    }
}
