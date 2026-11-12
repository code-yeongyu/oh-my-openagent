//! The settle an `observe()` runs before its walk: the busy wait, then the quiet window.

use omo_computer_core::observation::{BusyIndicator, ObservationSettle, SettleOutcome};
use omo_computer_core::settle_profile::SettleRegime;
use serde_json::json;

use super::{expected, params, Rig};

#[test]
fn loading_indicator_clears_before_observe_returns() {
    let mut rig = Rig::new(json!({"busy_timeline": [
        {"t_ms": 0, "window": "101", "busy": true, "indicator": "AXProgressIndicator"},
        {"t_ms": 800, "window": "101", "busy": false}
    ]}));
    let observation = rig
        .session
        .observe(params(json!({"target": "101"})))
        .expect("observe");
    assert_eq!(
        observation.settle,
        Some(expected(
            SettleOutcome::Settled,
            SettleRegime::Unchanged,
            500,
            1_300
        )),
        "800 ms until the indicator cleared, then 500 ms of quiet"
    );
    assert!(rig.clock.now_ms() >= 1_300 && observation.tree.is_some());
}

#[test]
fn busy_target_at_regime_cap_returns_settle_timeout_with_indicator() {
    let mut rig = Rig::new(json!({
        "busy_timeline": [{"t_ms": 0, "window": "101", "busy": true, "indicator": "spinner"}]
    }));
    let observation = rig
        .session
        .observe(params(json!({"target": "101"})))
        .expect("a read never refuses on busy");
    assert_eq!(
        observation.settle,
        Some(ObservationSettle {
            outcome: SettleOutcome::Timeout,
            indicator: Some(BusyIndicator::Spinner),
            quiet_ms: 500,
            waited_ms: 1_000,
            regime: Some(SettleRegime::Unchanged),
        })
    );
    assert!(
        observation.tree.is_some(),
        "the tree as read rides with the timeout"
    );
}
