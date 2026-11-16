//! What the session holds right now, for the engine's release helper (row 28, G3): the helper
//! keeps a copy so it can lift every hold after the engine dies.

use omo_computer_core::holds::Held;

use crate::Session;

impl Session {
    /// The held keys and buttons, in press order.
    #[must_use]
    pub fn held_inputs(&self) -> Vec<Held> {
        self.funnel.control.holds.held()
    }
}
