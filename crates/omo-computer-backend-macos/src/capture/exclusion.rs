//! The exclusion proof: a model-bound still ships only when it provably holds none of the
//! engine's own windows (overlay, receipt). A stream frame never answers a still.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::helper::{FilterKind, FrameSource, HelperReply};

/// The refusal of a frame that cannot prove what it holds.
pub const UNTRUSTED: Refusal = Refusal::new(EngineCode::CaptureFailed, Reason::UntrustedPixels);

/// Accepts `reply` for a still asked with `expected` that had to exclude `required`.
///
/// A window still through the desktop-independent window filter holds that window's own
/// pixels only. A display still must name every required window as excluded.
///
/// # Errors
/// [`UNTRUSTED`] when the reply is not a still of the expected filter or misses an exclusion.
pub fn prove(reply: &HelperReply, expected: FilterKind, required: &[u32]) -> Result<(), Refusal> {
    if reply.source != Some(FrameSource::Screenshot) || reply.filter != Some(expected) {
        return Err(UNTRUSTED);
    }
    match expected {
        FilterKind::Window => Ok(()),
        FilterKind::Display if required.iter().all(|id| reply.excluded.contains(id)) => Ok(()),
        FilterKind::Display => Err(UNTRUSTED),
    }
}
