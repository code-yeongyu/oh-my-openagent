//! Private mode (row 26; acceptance 62; d-a11y-model.md:356): when the window's focused element
//! is secure, or Secure Input is on, `observe` answers `secure:true` with the tree, the diff, the
//! frame, the focused element and the selected text all withheld.

use omo_computer_core::observation::Observation;
use omo_computer_core::session_state::Tristate;

use crate::session_state::sample;
use crate::Session;

impl Session {
    pub(crate) fn private_mode(&self, window: &str) -> bool {
        self.backend.secure_focus(Some(window)) == Some(true)
            || sample(self.backend.as_ref()).secure_input_active == Tristate::Known(true)
    }
}

/// The literal the pin names for a secure field the agent must not fill (d-a11y-model.md:356).
const PRIVATE_NEXT_CALL: &str = "ask the user to fill the field";

pub(crate) fn withhold_observation(observation: &mut Observation) {
    observation.secure = Some(true);
    observation.next_call = Some(PRIVATE_NEXT_CALL.to_owned());
    observation.tree = None;
    observation.diff = None;
    observation.frame = None;
    observation.focused = None;
    observation.selected_text = None;
    observation.cuts.clear();
    observation.nodes_observed = 0;
}
