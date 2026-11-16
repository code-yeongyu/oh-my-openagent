//! How a verb's input reaches the OS: the route a call takes and the key events it sends.

use omo_computer_core::backend::{InputEvent, Route};
use omo_computer_core::params::Delivery;

pub(crate) fn key_event(key: &str, down: bool) -> InputEvent {
    InputEvent::Key {
        key: key.to_owned(),
        down,
    }
}

/// A call aimed at a window goes to that window in the background unless it asks for the
/// foreground; a call with no target can only reach the foreground.
pub(crate) fn route_for(target: Option<&str>, delivery: Option<Delivery>) -> Route {
    match (target, delivery) {
        (Some(_), None | Some(Delivery::Background)) => Route::BackgroundWindow,
        (None, _) | (Some(_), Some(Delivery::Foreground)) => Route::ForegroundHid,
    }
}
