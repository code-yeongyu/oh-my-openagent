//! The one settle table (amendment A3): every duration the engine's settle waits on lives here
//! and nowhere else. The values are TARGETs seeded from the measured source rows the design
//! cites (`design/d-a11y-model.md` '### Settle rules': ASD-53, with ASD-52 as the second
//! witness) until this program's bench measures them; a value changes only with a bench receipt.

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

pub const SETTLE_PROFILE: SettleProfile = SettleProfile {
    // ASD-53: 150 ms of quiet after an input whose settle saw a change. The design gives this
    // regime no cap of its own; a settle that switches into it keeps the unchanged cap.
    changed: RegimeNumbers {
        quiet_ms: 150,
        cap_ms: 1_000,
    },
    // ASD-53: 500 ms of quiet, cap 1,000 ms, after an input with no detected change (the cap
    // meets acceptance 18's milestones: pending at 200 ms, settled at 1 s).
    unchanged: RegimeNumbers {
        quiet_ms: 500,
        cap_ms: 1_000,
    },
    // ASD-53: 600 ms of quiet, cap 2,000 ms, after a navigation.
    navigation: RegimeNumbers {
        quiet_ms: 600,
        cap_ms: 2_000,
    },
    // ASD-53: the 20 ms sampling tick of the busy and frame probes inside a wait.
    tick_ms: 20,
    // Acceptance 93 (GTH-02, OMC-45): admission waits in 50 ms slices, so a foreign event
    // within one slice before the send holds it.
    attribution_before_ms: 50,
    // Acceptance 93: a foreign event 300 ms after the send is reported, one 600 ms after is not.
    attribution_after_ms: 500,
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
