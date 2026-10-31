//! Lock and display-sleep notes on failures, and the live `displayAsleep`
//! capability, read through the backend's [`ScreenProbe`] so neither waits on
//! a busy backend.

use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::backend::ScreenProbe;
use senpi_desktop_core::error::DesktopError;
use senpi_desktop_core::types::{DisplaySelector, ScreenState, Target};

use crate::request::Op;

/// The current backend's probe; the session thread installs it at every
/// backend change and the session handle reads it.
#[derive(Clone, Default)]
pub(crate) struct ScreenNotes(Arc<Mutex<Option<Arc<dyn ScreenProbe>>>>);

impl ScreenNotes {
    pub(crate) fn install(&self, probe: Option<Arc<dyn ScreenProbe>>) {
        *self.0.lock() = probe;
    }

    /// `None` when the backend cannot read the screen state.
    pub(crate) fn live(&self, display: Option<&DisplaySelector>) -> Option<ScreenState> {
        let probe = self.0.lock().clone();
        probe.map(|probe| probe.screen_state(display))
    }

    /// Names the lock or display sleep in a failure they may have caused.
    pub(crate) fn explain(
        &self,
        error: DesktopError,
        display: Option<&DisplaySelector>,
    ) -> DesktopError {
        if !ScreenState::explains(error.code) {
            return error;
        }
        match self.live(display) {
            Some(state) => state.explain(error),
            None => error,
        }
    }
}

/// The display a request aims at, so its failure reports that display's
/// sleep rather than the whole session's.
pub(crate) fn op_display(op: &Op) -> Option<DisplaySelector> {
    let target = match op {
        Op::Capture(params) => &params.target,
        Op::CaptureRegion(params) => &params.target,
        Op::Click(params) | Op::MoveMouse(params) => &params.target,
        Op::Drag(params) => &params.target,
        Op::Scroll(params) => &params.target,
        Op::TypeText(params) => &params.target,
        Op::KeyChord(params) => &params.target,
        Op::HoldKeys(params) => &params.target,
        Op::HoldMouse(params) => &params.target,
        _ => return None,
    };
    Target::parse(target).display_selector()
}
