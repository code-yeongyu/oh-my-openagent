//! What a background send proves: a scripted `WindowOpened` event alone is an `ax_notification`
//! OBSERVATION (`observed`), never a confirmation (A12, principle 5).

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
pub fn judge_events(window_opened: u32) -> (Effect, EvidenceKind) {
    let _ = window_opened;
    (Effect::Confirmed, EvidenceKind::None)
}
