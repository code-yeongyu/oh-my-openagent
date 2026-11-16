//! What the Damage wait concludes from one `DamageNotify` (reviews M3 and L4 of #13354).
//! `ClearArea(exposures=true)` may make the server paint the window background itself (it does
//! not for a background of None), and the server reports that paint while it is still
//! processing the `ClearArea`. An event carries the sequence number of the last request of
//! ours the server processed, and the capture sends a round trip right behind the `ClearArea`,
//! so a notify carrying the `ClearArea`'s own sequence number is the server's paint and any
//! other notify is the client's repaint after its Expose. The damage object reports raw
//! rectangles, so a repaint that lands right after the server's paint is a notify of its own:
//! nothing is subtracted and nothing merges into an already non-empty region.

/// What one `DamageNotify` means for the wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageWait {
    /// The server's own background paint for the `ClearArea`: keep waiting.
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

    /// The meaning of a notify that carries `sequence`.
    #[must_use]
    pub const fn after_notify(self, sequence: u16) -> DamageWait {
        if sequence == self.clear_sequence {
            DamageWait::ServerPaint
        } else {
            DamageWait::Repainted
        }
    }
}
