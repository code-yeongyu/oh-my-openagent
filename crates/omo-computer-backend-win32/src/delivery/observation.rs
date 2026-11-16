//! What a background send proves: a `WindowOpened` event alone, from the handler registered on the
//! toplevel BEFORE the send, is an `ax_notification` OBSERVATION (`observed`), never a confirmation
//! (A12, principle 5): a window can open without the click. Only the `barrier_consumed` receipt
//! confirms that a pointer or key verb was dequeued, and nothing here confirms an effect.

/// The effect the report states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    Confirmed,
    Observed,
    Unverifiable,
}

/// The evidence class behind the effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceKind {
    AxNotification,
    None,
}

/// The effect of a send after which only `window_opened` events were seen.
#[must_use]
pub const fn judge_events(window_opened: u32) -> (Effect, EvidenceKind) {
    if window_opened > 0 {
        (Effect::Observed, EvidenceKind::AxNotification)
    } else {
        (Effect::Unverifiable, EvidenceKind::None)
    }
}
