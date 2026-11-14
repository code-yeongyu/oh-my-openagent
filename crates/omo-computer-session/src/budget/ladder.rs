//! The per-hand frame budget: at most 2 frames per second, over which a capture answers
//! `InputBusy{reason:"budget"}` (`COMPUTER_BUSY`) with the wait in `retryAfterMs`; and the
//! encoding ladder PNG -> JPEG -> artifact under `maxFrameBytes`.

use std::collections::VecDeque;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

pub const FRAMES_PER_SECOND: usize = 2;
const WINDOW_MS: u64 = 1_000;

/// `InputBusy{budget}`.
pub const BUDGET_BUSY: Refusal = Refusal::new(EngineCode::InputBusy, Reason::Budget.wire());

/// The frames of the last second.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FrameBudget {
    recent: VecDeque<u64>,
}

impl FrameBudget {
    /// Admits one frame at `now_ms`.
    ///
    /// # Errors
    /// The refusal and its `retryAfterMs` when the hand is over budget.
    pub fn admit(&mut self, now_ms: u64) -> Result<(), (Refusal, u64)> {
        while self
            .recent
            .front()
            .is_some_and(|at| now_ms.saturating_sub(*at) >= WINDOW_MS)
        {
            self.recent.pop_front();
        }
        if self.recent.len() >= FRAMES_PER_SECOND {
            let oldest = self.recent.front().copied().unwrap_or(now_ms);
            return Err((BUDGET_BUSY, WINDOW_MS - now_ms.saturating_sub(oldest)));
        }
        self.recent.push_back(now_ms);
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Png,
    Jpeg,
    /// Over `maxFrameBytes` either way: the reply carries `{digest, size}` only.
    Artifact,
}

/// The first rung whose size fits `max_frame_bytes`.
#[must_use]
pub const fn encoding_for(png_bytes: u64, jpeg_bytes: u64, max_frame_bytes: u64) -> Encoding {
    if png_bytes <= max_frame_bytes {
        Encoding::Png
    } else if jpeg_bytes <= max_frame_bytes {
        Encoding::Jpeg
    } else {
        Encoding::Artifact
    }
}
