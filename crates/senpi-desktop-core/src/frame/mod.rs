//! Capture frame geometry: capture pixels <-> global logical desktop points,
//! capture caps, and PNG encoding.

mod caps;
mod encode;
mod geometry;

pub use caps::{apply_capture_caps, MAX_COMPOSITE_PIXELS};
pub use encode::encode_png;
pub use geometry::FrameGeometry;

/// Rounds a pixel measure to `u32`. Float-to-int `as` saturates (negative and
/// NaN become 0, overflow becomes `u32::MAX`), the clamp every caller wants.
fn round_to_u32(value: f64) -> u32 {
    value.round() as u32
}

#[cfg(test)]
mod tests;
