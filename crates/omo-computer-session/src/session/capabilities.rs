//! Capability replies in the open session's report mode.

use omo_computer_core::backend::PermissionProbe;
use omo_computer_core::capabilities::{Capabilities, InputMode, LegacyCapabilities};
use omo_computer_core::params::ReportMode;
use omo_computer_core::results::{CapabilitiesReply, PermissionState};
use omo_computer_core::session_state::Tristate;

use super::Session;

/// `stopReason` while no stop path is armed: `session.open` arms none (`stopPath.start` does).
pub const NO_GLOBAL_LISTENER: &str = "no-global-listener";

impl Session {
    /// The capabilities in the open session's report mode; with no session, the v1 shape.
    #[must_use]
    pub fn capabilities(&self) -> CapabilitiesReply {
        let capabilities = self.sampled_capabilities();
        match self.opened.as_ref().map(|opened| opened.report_mode) {
            Some(ReportMode::Object) => CapabilitiesReply::Object(Box::new(capabilities)),
            Some(ReportMode::Null) | None => CapabilitiesReply::Legacy(Box::new(
                legacy_capabilities(&capabilities, &self.backend.probe_permissions()),
            )),
        }
    }
}

const fn permission(state: PermissionState) -> &'static str {
    match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        PermissionState::Unknown => "unknown",
    }
}

const fn known_true(state: Tristate) -> bool {
    matches!(state, Tristate::Known(true))
}

/// The v1 record a null-mode session reads, projected from the object-mode capabilities.
#[must_use]
pub fn legacy_capabilities(caps: &Capabilities, probe: &PermissionProbe) -> LegacyCapabilities {
    LegacyCapabilities {
        backend: caps.backend.clone(),
        display_server: None,
        capture: caps.capture.available,
        input: caps.window_input.available,
        ax: caps.input_modes.contains(&InputMode::Ax),
        background_window_input: caps.background_window_input,
        cursor_overlay: false,
        delivery_modes: caps.delivery_modes.clone(),
        capture_permission: permission(probe.capture).to_owned(),
        input_permission: permission(probe.input).to_owned(),
        ax_permission: permission(probe.accessibility).to_owned(),
        display_count: caps.display_count,
        focus_guard: caps.background_window_input,
        stop_path: "none".to_owned(),
        stop_reason: Some(NO_GLOBAL_LISTENER.to_owned()),
        integrity_level: None,
        screen_locked: known_true(caps.session.screen_locked),
        display_asleep: Some(known_true(caps.session.display_asleep)),
    }
}
