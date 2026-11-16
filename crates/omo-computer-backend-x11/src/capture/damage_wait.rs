//! What the Damage wait concludes from the notifies it has seen (review M3 of #13354).
//! `ClearArea(exposures=true)` makes the server paint the window background itself before the
//! client sees its Expose, and that paint fires the first `DamageNotify` of a NON_EMPTY damage
//! object. Only a notify after that damage is subtracted is the client's own repaint.

/// The next step of the wait after a `DamageNotify`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageWait {
    /// Subtract the damage seen so far and keep waiting for the client's paint.
    SubtractAndWait,
    /// The client repainted after its Expose: the pixmap holds its pixels.
    Repainted,
}

/// The step after the `seen`-th notify (counted from 1).
#[must_use]
pub const fn after_notify(seen: usize) -> DamageWait {
    if seen >= 2 {
        DamageWait::Repainted
    } else {
        DamageWait::SubtractAndWait
    }
}

/// One Damage wait: the notifies of one `ClearArea` round, in arrival order.
#[derive(Debug, Clone, Copy)]
pub struct DamageWatch {
    seen: usize,
}

impl DamageWatch {
    /// A wait for the `ClearArea` request sent with `_clear_sequence` (low 16 bits).
    #[must_use]
    pub const fn new(_clear_sequence: u16) -> Self {
        Self { seen: 0 }
    }

    /// The step after a notify that carries `_sequence`.
    pub const fn after_notify(&mut self, _sequence: u16) -> DamageWait {
        self.seen += 1;
        after_notify(self.seen)
    }
}
