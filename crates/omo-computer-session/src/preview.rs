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
    outbox: Vec<PreviewFrame>,
}

impl Preview {
    pub fn subscribe(&mut self) {
        self.subscribed = true;
    }

    #[must_use]
    pub const fn is_subscribed(&self) -> bool {
        self.subscribed
    }

    /// Offers one captured frame at `now_ms`.
    ///
    /// # Errors
    /// Why the frame was dropped; nothing is emitted then.
    pub fn offer(&mut self, now_ms: u64, lease_active: bool, frame: FrameBytes) -> Result<(), Dropped> {
        if !self.subscribed {
            return Err(Dropped::NotSubscribed);
        }
        if !lease_active {
            return Err(Dropped::NoLease);
        }
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
        self.outbox.push(PreviewFrame { at_ms: now_ms, frame });
        Ok(())
    }

    /// The frames for the host's `preview.frame` notifications, oldest first.
    pub fn drain(&mut self) -> Vec<PreviewFrame> {
        std::mem::take(&mut self.outbox)
    }
}
