//! Session surfaces: capabilities (with scripted Secure Input), permissions, the stop
//! listener, the epoch source and the presence surface.

use omo_computer_core::backend::{
    BackendResult, EpochSource, PermissionProbe, Presence, Refusal, StopListener,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::results::PermissionState;
use omo_computer_core::session_state::Tristate;

use crate::backend::{FakeBackend, StopPathScript};
use crate::capabilities::fake_capabilities;
use crate::handles::{FakeEpochSource, FakePresence, FakeStopListener};

pub(super) const fn granted_permissions() -> PermissionProbe {
    PermissionProbe {
        capture: PermissionState::Granted,
        input: PermissionState::Granted,
        accessibility: PermissionState::Granted,
    }
}

impl FakeBackend {
    pub(super) fn scripted_capabilities(&self) -> Capabilities {
        let displays = self.lock().displays.len();
        let mut capabilities =
            self.with_scripted_session(fake_capabilities(self.persona, displays, self.stop_path));
        let state = self.lock();
        // Secure Input: scripted on (`secure_input_on`), or a scripted secure focus while its
        // window is the focused, live one. Neither declared keeps today's value.
        let input_on = state.scenario.secure_input_on;
        let focused = state.scenario.secure_focus.as_ref().map(|secure| {
            state.windows.iter().any(|window| {
                window.focused && window.id == secure.window && !state.exited.contains(&window.id)
            })
        });
        if input_on || focused.is_some() {
            capabilities.session.secure_input_active =
                Tristate::Known(input_on || focused == Some(true));
        }
        capabilities
    }

    pub(super) fn scripted_stop_listener(&self) -> BackendResult<Box<dyn StopListener>> {
        match self.stop_path {
            StopPathScript::None => Err(Refusal::new(
                EngineCode::StopPathUnavailable,
                Reason::NoListener.wire(),
            )),
            script => Ok(Box::new(FakeStopListener::new(self.shared.clone(), script))),
        }
    }

    pub(super) fn scripted_epoch_source(&self) -> Box<dyn EpochSource> {
        Box::new(FakeEpochSource::new(self.shared.clone()))
    }

    /// Row 21: the scenario's `consent` view, with `fullAccess` set under the full-access preset.
    pub(super) fn scripted_host_consent(&self) -> Option<serde_json::Value> {
        let state = self.lock();
        let mut view = state.scenario.consent.clone();
        if state.scenario.full_access_preset {
            if let Some(map) = view.get_or_insert_with(|| serde_json::json!({})).as_object_mut() {
                map.insert("fullAccess".to_owned(), serde_json::Value::Bool(true));
            }
        }
        view
    }

    pub(super) fn scripted_presence(&self) -> Option<Box<dyn Presence>> {
        let available = self.lock().scenario.presence_surface.unwrap_or(true);
        available.then(|| Box::new(FakePresence::new(self.sink.clone())) as Box<dyn Presence>)
    }
}
