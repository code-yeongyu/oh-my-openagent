//! The long-lived handles a backend hands out, and the refusing handle each default returns.

use super::refusal::{BackendResult, Refusal};
use super::types::{AxEvent, EpochChange};
use crate::error::EngineCode;

/// A listen-only stop listener that injected input cannot trigger.
pub trait StopListener: Send {
    /// Whether the user pressed the stop chord since the last poll.
    ///
    /// # Errors
    /// The listener cannot hear (deaf, parked or gone).
    fn poll_stop(&mut self) -> BackendResult<bool>;
}

/// The source of display, scale, session and lock changes that supersede frames and refs.
pub trait EpochSource: Send {
    /// The next change, or `None` when nothing changed.
    ///
    /// # Errors
    /// The backend has no epoch source.
    fn next_change(&mut self) -> BackendResult<Option<EpochChange>>;
}

/// The overlay, border and stop affordance shown while the engine drives the desktop.
pub trait Presence: Send {
    /// # Errors
    /// The surface cannot be shown.
    fn show(&mut self) -> BackendResult<()>;

    /// # Errors
    /// The surface cannot be hidden.
    fn hide(&mut self) -> BackendResult<()>;
}

/// The accessibility observer events the settle and `waitFor` consume.
pub trait AxEventSource: Send {
    /// The next event, or `None` when none is pending.
    ///
    /// # Errors
    /// The backend has no observer.
    fn next_event(&mut self) -> BackendResult<Option<AxEvent>>;
}

/// The epoch source of a backend that has none: every read refuses.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoEpochSource;

impl EpochSource for NoEpochSource {
    fn next_change(&mut self) -> BackendResult<Option<EpochChange>> {
        Err(Refusal::new(
            EngineCode::Internal,
            "epoch_source_unsupported",
        ))
    }
}

/// The event source of a backend without an accessibility observer: every read refuses.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoAxEvents;

impl AxEventSource for NoAxEvents {
    fn next_event(&mut self) -> BackendResult<Option<AxEvent>> {
        Err(Refusal::new(
            EngineCode::AxUnsupported,
            "ax_events_unsupported",
        ))
    }
}
