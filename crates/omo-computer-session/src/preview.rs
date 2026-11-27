//! The preview lane (acceptance 55; design row C15): `preview.subscribe` from the host, then
//! `preview.frame` notifications - JPEG, at most 960 px on the long edge, at most 256 KiB, at
//! most 2 per second - ONLY while a foreground lease is active. Frames go to the host outbox
//! and never into anything model-bound (no reply, no audit image, no tool result). The caps are
//! the contract's own (amendment A2: no vendor citation is a reason for them).

use omo_computer_core::backend::FrameBytes;

pub const MAX_LONG_EDGE_PX: u32 = 960;
pub const MAX_BYTES: usize = 256 * 1024;
/// Two frames per second.
pub const MIN_INTERVAL_MS: u64 = 500;

/// Why a frame was not emitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dropped {
    NotSubscribed,
    NoLease,
    PictureWithheld,
    TooSoon,
    TooLarge,
    NotJpeg,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewFrame {
    pub at_ms: u64,
    pub frame: FrameBytes,
}

/// The lane of one session.
#[derive(Debug, Default)]
pub struct Preview {
    subscribed: bool,
    last_ms: Option<u64>,
    pending: Option<PreviewFrame>,
}

impl Preview {
    pub fn subscribe(&mut self) {
        self.subscribed = true;
    }

    pub(crate) fn end_session(&mut self) {
        self.subscribed = false;
        self.discard_pending();
        // Reopening on this producer must not reset its rate limit.
    }

    #[must_use]
    pub const fn is_subscribed(&self) -> bool {
        self.subscribed
    }

    /// Offers one captured frame at `now_ms`.
    ///
    /// # Errors
    /// Why the frame was dropped; nothing is emitted then.
    pub(crate) fn offer_eligible(&mut self, now_ms: u64, frame: FrameBytes) -> Result<(), Dropped> {
        if frame.mime != omo_computer_core::observation::ImageMime::Jpeg {
            return Err(Dropped::NotJpeg);
        }
        if frame.width.max(frame.height) > MAX_LONG_EDGE_PX || frame.bytes.len() > MAX_BYTES {
            return Err(Dropped::TooLarge);
        }
        if self.last_ms.is_some_and(|last| now_ms.saturating_sub(last) < MIN_INTERVAL_MS) {
            return Err(Dropped::TooSoon);
        }
        self.last_ms = Some(now_ms);
        self.pending = Some(PreviewFrame { at_ms: now_ms, frame });
        Ok(())
    }

    pub(crate) fn discard_pending(&mut self) {
        self.pending = None;
    }

    /// A slow viewer gets the latest eligible frame, never a backlog.
    pub fn drain(&mut self) -> Vec<PreviewFrame> {
        self.pending.take().into_iter().collect()
    }
}
