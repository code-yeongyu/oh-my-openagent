//! Row 19's tests: the settle table and its source guard, the post-send and read settles, the
//! busy wait, `waitFor` and the attribution window, on the fake backend and its clock.

mod attribution;
mod burst;
mod exec;
mod guard;
mod notification;
mod observe;
mod primitive;
mod rig;
mod wait_for;

use omo_computer_core::observation::{ObservationSettle, SettleOutcome};
use omo_computer_core::results::ExecReply;
use omo_computer_core::settle_profile::SettleRegime;
use serde_json::Value;

pub(super) use rig::Rig;

pub(super) fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

/// The `settle` member of an object-mode click's report.
pub(super) fn report_settle(reply: &ExecReply) -> ObservationSettle {
    let report = reply.0.as_ref().expect("an object-mode report");
    report
        .settle()
        .cloned()
        .expect("the report carries the post-send settle")
}

/// A settle with no busy indicator.
pub(super) const fn expected(
    outcome: SettleOutcome,
    regime: SettleRegime,
    quiet_ms: u64,
    waited_ms: u64,
) -> ObservationSettle {
    ObservationSettle {
        outcome,
        indicator: None,
        quiet_ms,
        waited_ms,
        regime: Some(regime),
    }
}
