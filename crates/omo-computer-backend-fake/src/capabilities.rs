//! The capability vector the fake reports: a fully capable host of its persona.

use omo_computer_core::backend::refusing_capabilities;
use omo_computer_core::capabilities::{
    Availability, BackgroundBasis, BackgroundReach, Capabilities, CaptureCapability, DeafReason,
    DeliveryMode, InputMode, StopPathCapability, StopPathKind,
};

use crate::backend::StopPathScript;
use crate::persona::Persona;

/// The `backend` member every persona reports, so null-mode replies stay byte-equal to v1.
pub const BACKEND_NAME: &str = "fake";

const fn available() -> Availability {
    Availability {
        available: true,
        reason: None,
    }
}

#[must_use]
pub fn fake_capabilities(persona: Persona, displays: usize, stop: StopPathScript) -> Capabilities {
    let mut capabilities = refusing_capabilities();
    BACKEND_NAME.clone_into(&mut capabilities.backend);
    capabilities.display_count = u32::try_from(displays).unwrap_or(u32::MAX);
    capabilities.delivery_modes = vec![DeliveryMode::Background, DeliveryMode::Foreground];
    capabilities.capture = CaptureCapability {
        available: true,
        reason: None,
        route: persona.capture_route(),
    };
    capabilities.window_capture = available();
    capabilities.window_input = available();
    capabilities.observe = true;
    capabilities.settle = true;
    capabilities.background_window_input = true;
    capabilities.background_window_input_basis = BackgroundBasis::RouteAvailable;
    capabilities.input_modes = vec![InputMode::Pointer, InputMode::Keyboard, InputMode::Ax];
    capabilities.background_reach = BackgroundReach::Full;
    capabilities.stop_path = StopPathCapability {
        kind: if stop == StopPathScript::None {
            StopPathKind::None
        } else {
            StopPathKind::Global
        },
        host_relay_live: false,
        allow_host_relay_only: false,
        listener: if stop == StopPathScript::None {
            "none"
        } else {
            persona.stop_listener()
        }
        .to_owned(),
        deaf: stop == StopPathScript::Deaf,
        stale: false,
        deaf_reason: (stop == StopPathScript::Deaf).then_some(DeafReason::ListenerParked),
    };
    capabilities
}
