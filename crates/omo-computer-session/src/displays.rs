//! `displays()` and the display a `display(active|all|<id>)` capture shows. `displays()` lists
//! every display whatever selector the last capture used.

use omo_computer_core::backend::{Refusal, WindowFilter};
use omo_computer_core::error::EngineCode;
use omo_computer_core::frame::{composite, Composite, DisplaySelector};
use omo_computer_core::results::DisplayInfo;

use crate::Session;

impl Session {
    /// Every display.
    ///
    /// # Errors
    /// The backend's displays refusal.
    pub fn displays(&mut self) -> Result<Vec<DisplayInfo>, Refusal> {
        self.backend.displays()
    }

    /// The composite `selector` shows; `active` is the display the focused window covers most.
    ///
    /// # Errors
    /// The backend's displays refusal, or `InvalidTarget` when the selector names no display.
    pub fn display_plan(&mut self, selector: &DisplaySelector) -> Result<Composite, Refusal> {
        let displays = self.backend.displays()?;
        let focused = self
            .backend
            .windows(&WindowFilter::default())
            .ok()
            .and_then(|list| list.windows.into_iter().find(|window| window.focused))
            .map(|window| window.bounds);
        composite(&displays, selector, focused.as_ref())
            .ok_or(Refusal::bare(EngineCode::InvalidTarget))
    }
}
