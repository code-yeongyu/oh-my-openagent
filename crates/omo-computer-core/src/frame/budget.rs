//! The frame byte ladder: inline PNG, then inline JPEG, then the full PNG as an artifact.
//! Caps only tighten the inline budget per call.

/// The local inline budget (bytes of the encoded image).
pub const INLINE_BUDGET_BYTES: u64 = 5_000_000;
/// The JPEG quality of the ladder's second step.
pub const JPEG_QUALITY: u8 = 70;

/// How a frame's bytes travel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    InlinePng(Vec<u8>),
    InlineJpeg(Vec<u8>),
    /// Over the inline budget at every step: the full PNG is written as an artifact.
    Artifact(Vec<u8>),
}

/// The JPEG step of the ladder.
pub trait Reencode {
    /// The PNG re-encoded as JPEG at `quality`, or `None` when no encoder is present.
    fn jpeg(&self, png: &[u8], quality: u8) -> Option<Vec<u8>>;
}

/// A host without a JPEG encoder: the ladder goes from PNG to the artifact.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoJpeg;

impl Reencode for NoJpeg {
    fn jpeg(&self, _png: &[u8], _quality: u8) -> Option<Vec<u8>> {
        None
    }
}

/// Signature only at the test-first commit.
#[must_use]
pub fn ladder(png: Vec<u8>, budget: u64, encoder: &dyn Reencode) -> Delivery {
    let _ = (budget, encoder);
    Delivery::InlinePng(png)
}
