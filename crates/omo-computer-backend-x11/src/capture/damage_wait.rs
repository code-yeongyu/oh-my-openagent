//! What the Damage wait concludes from one `DamageNotify` (reviews M3, L4 and H1 of #13354).
//! Two notifies come before the client can repaint: `DamageCreate` reports the whole window at
//! once, and `ClearArea(exposures=true)` may make the server paint the window background
//! itself (not for a background of None). An event carries the sequence number of the last
//! request of ours the server processed, and the capture sends a round trip right behind the
//! `ClearArea`, so only a notify whose sequence is AFTER the `ClearArea`'s (16-bit wrapping
//! order) is the client's repaint after its Expose. The damage object reports raw
//! rectangles, so a repaint that lands right after the server's paint is a notify of its own:
//! nothing is subtracted and nothing merges into an already non-empty region.

/// What one `DamageNotify` means for the wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageWait {
    /// A report from before the client could repaint (the `DamageCreate` report or the
    /// server's background paint for the `ClearArea`): keep waiting.
    ServerPaint,
    /// The client repainted after its Expose: the pixmap holds its pixels.
    Repainted,
}

/// One Damage wait, keyed by the sequence number of its `ClearArea` request.
#[derive(Debug, Clone, Copy)]
pub struct DamageWatch {
    clear_sequence: u16,
}

impl DamageWatch {
    /// A wait for the `ClearArea` request sent with `clear_sequence` (the low 16 bits, as an
    /// event carries them).
    #[must_use]
    pub const fn new(clear_sequence: u16) -> Self {
        Self { clear_sequence }
    }

    /// The meaning of a notify that carries `sequence`: a repaint only when the sequence is
    /// after the `ClearArea`'s, half the 16-bit space being the future (X's own wrap rule).
    #[must_use]
    pub const fn after_notify(self, sequence: u16) -> DamageWait {
        let ahead = sequence.wrapping_sub(self.clear_sequence);
        if ahead != 0 && ahead < 0x8000 {
            DamageWait::Repainted
        } else {
            DamageWait::ServerPaint
        }
    }
}
