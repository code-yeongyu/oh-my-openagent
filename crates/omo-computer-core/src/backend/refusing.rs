//! The capability vector of a backend that implements nothing: every capability unavailable,
//! every session field unknown, no stop path.

use crate::capabilities::{
    Availability, BackgroundBasis, BackgroundReach, Capabilities, CaptureCapability, DisplayAwake,
    DisplayAwakeMechanism, DisplayAwakeState, SendOnEnterKeys, SessionProbes, StopPathCapability,
    StopPathKind, ToolkitRoutes,
};
use crate::session_state::{SessionState, Tristate, UnknownLiteral, UserActive};

const UNKNOWN: Tristate = Tristate::Unknown(UnknownLiteral::Unknown);
const NO_PROBE: &str = "none";
const REASON: &str = "backend_unsupported";

fn unavailable() -> Availability {
    Availability {
        available: false,
        reason: Some(REASON.to_owned()),
    }
}

/// Every field `"unknown"`: an unknown state never refuses and is reported.
#[must_use]
pub fn unknown_session_state() -> SessionState {
    SessionState {
        screen_locked: UNKNOWN,
        display_asleep: UNKNOWN,
        user_active: UserActive {
            active: UNKNOWN,
            last_input_age_ms: None,
        },
        secure_input_active: UNKNOWN,
        session_active: UNKNOWN,
        screensaver_active: UNKNOWN,
        pause_reasons: Vec::new(),
        sampled_at: 0,
    }
}

/// The capabilities a backend reports when it overrides nothing.
#[must_use]
pub fn refusing_capabilities() -> Capabilities {
    Capabilities {
        backend: "none".to_owned(),
        display_count: 0,
        delivery_modes: Vec::new(),
        capture: CaptureCapability {
            available: false,
            reason: Some(REASON.to_owned()),
            route: None,
        },
        window_capture: unavailable(),
        window_input: unavailable(),
        observe: false,
        settle: false,
        ocr: false,
        background_window_input: false,
        background_window_input_basis: BackgroundBasis::None,
        input_modes: Vec::new(),
        background_reach: BackgroundReach::AxOnly,
        toolkit_routes: ToolkitRoutes {
            seeded: Vec::new(),
            learned: Vec::new(),
        },
        session: unknown_session_state(),
        session_probes: SessionProbes {
            screen_locked: NO_PROBE.to_owned(),
            display_asleep: NO_PROBE.to_owned(),
            user_active: NO_PROBE.to_owned(),
            secure_input_active: NO_PROBE.to_owned(),
            session_active: NO_PROBE.to_owned(),
            screensaver_active: NO_PROBE.to_owned(),
            session_active_delivery_verified: false,
            auth_message: None,
            auth_message_probe: None,
        },
        display_awake: DisplayAwake {
            state: DisplayAwakeState::Idle,
            grace_ms: 0,
            cap_ms: 0,
            held_since_ms: None,
            mechanism: DisplayAwakeMechanism::Unavailable,
        },
        release_helper: None,
        surfaces: Vec::new(),
        route_ladder: Vec::new(),
        send_on_enter: SendOnEnterKeys { keys: 0 },
        stop_path: StopPathCapability {
            kind: StopPathKind::None,
            host_relay_live: false,
            allow_host_relay_only: false,
            listener: NO_PROBE.to_owned(),
            deaf: false,
            stale: false,
            deaf_reason: None,
        },
        compositor: None,
    }
}
