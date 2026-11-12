//! The one settle table (amendment A3): every duration the engine's settle waits on lives here
//! and nowhere else.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Which settle numbers an input's settle picked, from what it saw.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SettleRegime {
    /// After an input whose settle saw a change.
    Changed,
    /// After an input with no detected change.
    Unchanged,
    /// After a navigation: a new window, app, Space or desktop, web-area URL or document.
    Navigation,
}

/// The quiet window and the cap of one regime, in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RegimeNumbers {
    pub quiet_ms: u64,
    pub cap_ms: u64,
}

/// The table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettleProfile {
    pub changed: RegimeNumbers,
    pub unchanged: RegimeNumbers,
    pub navigation: RegimeNumbers,
    /// The period at which the busy and frame probes are re-read inside a wait.
    pub tick_ms: u64,
    /// How long before a send a foreign event still holds it.
    pub attribution_before_ms: u64,
    /// How long after a send a foreign event is still reported against it.
    pub attribution_after_ms: u64,
}

const UNSET: RegimeNumbers = RegimeNumbers {
    quiet_ms: 0,
    cap_ms: 0,
};

pub const SETTLE_PROFILE: SettleProfile = SettleProfile {
    changed: UNSET,
    unchanged: UNSET,
    navigation: UNSET,
    tick_ms: 0,
    attribution_before_ms: 0,
    attribution_after_ms: 0,
};

impl SettleRegime {
    /// The numbers of this regime.
    #[must_use]
    pub const fn numbers(self) -> RegimeNumbers {
        match self {
            Self::Changed => SETTLE_PROFILE.changed,
            Self::Unchanged => SETTLE_PROFILE.unchanged,
            Self::Navigation => SETTLE_PROFILE.navigation,
        }
    }
}
