//! The live input of one display: its own XTEST/XKB connection, row 27's seeded route table, and
//! the release helper that releases the engine's holds if the engine dies.

use omo_computer_core::routes::RouteTable;

use super::connection::InputConnection;
use super::server::InputServer;
use super::{InputSettings, X11Input};
use crate::release_helper::{HelperCommand, Witness};

/// The input of `display`; `None` (logged) when the display lacks XTEST or XKB. A helper that
/// cannot start is logged and reported by `capabilities().release_helper`.
#[must_use]
pub fn connect(display: &str) -> Option<X11Input> {
    let connection = match InputConnection::connect(display) {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("omo-computer-backend-x11: no input on display {display}: {error}");
            return None;
        }
    };
    let settings = InputSettings {
        routes: RouteTable::seed().unwrap_or_default(),
        ..InputSettings::default()
    };
    let input = X11Input::new(Box::new(connection) as Box<dyn InputServer>, settings);
    match HelperCommand::engine().map(|command| Witness::spawn(&command, display)) {
        Some(Ok(witness)) => Some(input.with_witness(Box::new(witness))),
        Some(Err(error)) => {
            eprintln!("omo-computer-backend-x11: no release helper: {error}");
            Some(input)
        }
        None => Some(input),
    }
}
