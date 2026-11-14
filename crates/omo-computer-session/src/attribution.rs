//! The attribution window for foreign events (acceptance 93): physical input from the user close
//! to a send is FOREIGN to it. One inside the window before the send holds the send (admission
//! refuses `UserIntervened`); one inside the window after it is reported in
//! `attribution{foreignEvents, firstForeignAtMs}` with the send already out; one outside is
//! not counted, and the engine's own tagged input never is. Times are the backend's monotonic
//! clock; the window's bounds are rows of `SETTLE_PROFILE`.
//!
//! Row 19 builds and tests the window; the send path consults it from row 22 (a `C5` row of
//! `DEFERRED-LEGS.tsv` owes the wiring).

use omo_computer_core::settle_profile::SETTLE_PROFILE;

/// One input event the backend's foreign-input filter reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InputSeen {
    pub at_ms: u64,
    /// The engine's own tag (or XTEST / injected flag) was on it.
    pub own: bool,
}

/// Where an event falls against a send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    BeforeSend,
    AfterSend,
    Outside,
}

/// `attribution{foreignEvents, firstForeignAtMs}` of a delivered send; the time is
/// milliseconds after the send.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Attribution {
    pub foreign_events: u32,
    pub first_foreign_at_ms: Option<u64>,
}

/// Where `event` falls against a send at `send_ms`.
#[must_use]
pub const fn place(event: InputSeen, send_ms: u64) -> Placement {
    if event.own {
        Placement::Outside
    } else if event.at_ms < send_ms {
        if send_ms - event.at_ms <= SETTLE_PROFILE.attribution_before_ms {
            Placement::BeforeSend
        } else {
            Placement::Outside
        }
    } else if event.at_ms - send_ms < SETTLE_PROFILE.attribution_after_ms {
        Placement::AfterSend
    } else {
        Placement::Outside
    }
}

/// Whether a foreign event inside the window before `send_ms` holds the send.
#[must_use]
pub fn holds_send(events: &[InputSeen], send_ms: u64) -> bool {
    events
        .iter()
        .any(|event| place(*event, send_ms) == Placement::BeforeSend)
}

/// The foreign events inside the window after `send_ms`.
#[must_use]
pub fn after_send(events: &[InputSeen], send_ms: u64) -> Attribution {
    let after: Vec<u64> = events
        .iter()
        .filter(|event| place(**event, send_ms) == Placement::AfterSend)
        .map(|event| event.at_ms - send_ms)
        .collect();
    Attribution {
        foreign_events: u32::try_from(after.len()).unwrap_or(u32::MAX),
        first_foreign_at_ms: after.iter().copied().min(),
    }
}
