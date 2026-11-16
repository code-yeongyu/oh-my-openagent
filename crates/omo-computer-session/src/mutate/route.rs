//! How a verb's input reaches the OS: the route a call takes and the key events it sends.

use omo_computer_core::backend::{InputEvent, Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Delivery;
use omo_computer_safety::TargetRef;

pub(crate) fn key_event(key: &str, down: bool) -> InputEvent {
    InputEvent::Key {
        key: key.to_owned(),
        down,
    }
}

/// A call aimed at a window goes to that window in the background unless it asks for the
/// foreground; a call with no target can only reach the foreground, and one that asks for the
/// background without naming its window (no target, or `desktop`) is refused before anything is sent (row 21a, IS-2).
///
/// # Errors
/// `BackgroundUnavailable{target_unknown}` (next call `computer.window(sel)`).
pub(crate) fn route_for(target: Option<&str>, delivery: Option<Delivery>) -> Result<Route, Refusal> {
    match (TargetRef::read(target), delivery) {
        (TargetRef::Window(window), None | Some(Delivery::Background)) => Ok(Route::BackgroundWindow {
            window: window.to_owned(),
        }),
        (TargetRef::Window(_) | TargetRef::Desktop, Some(Delivery::Foreground))
        | (TargetRef::Desktop, None) => Ok(Route::ForegroundHid),
        (TargetRef::Desktop, Some(Delivery::Background)) => Err(UNADDRESSED_BACKGROUND),
    }
}

/// A background call that names no window.
pub(crate) const UNADDRESSED_BACKGROUND: Refusal =
    Refusal::new(EngineCode::BackgroundUnavailable, Reason::TargetUnknown);
