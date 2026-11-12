//! The row-22 settings a session reads once at `session.open`: the intervention policy, the
//! pause ceiling and the display-awake hold's two limits.

use omo_computer_core::intervention::{
    DEFAULT_DISPLAY_AWAKE_GRACE_MS, DEFAULT_DISPLAY_AWAKE_SESSION_CAP_MS, DEFAULT_PAUSE_CEILING_MS,
};
use omo_computer_core::requests::SessionOpenRequest;
use omo_computer_core::settings::Intervention;

use super::HoldLimits;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpenSettings {
    pub policy: Intervention,
    pub pause_ceiling_ms: u64,
    pub hold_limits: HoldLimits,
}

impl OpenSettings {
    #[must_use]
    pub fn read(request: &SessionOpenRequest) -> Self {
        let timing = request.config.as_ref().map(|config| config.timing);
        Self {
            policy: request.intervention.unwrap_or(Intervention::Pause),
            pause_ceiling_ms: timing
                .and_then(|timing| timing.pause_ceiling_ms)
                .unwrap_or(DEFAULT_PAUSE_CEILING_MS),
            hold_limits: HoldLimits {
                grace_ms: timing
                    .and_then(|timing| timing.display_awake_grace_ms)
                    .unwrap_or(DEFAULT_DISPLAY_AWAKE_GRACE_MS),
                session_cap_ms: timing
                    .and_then(|timing| timing.display_awake_session_cap_ms)
                    .unwrap_or(DEFAULT_DISPLAY_AWAKE_SESSION_CAP_MS),
            },
        }
    }
}
