//! Design row C5's exit criterion (acceptance 18): a scripted 400 ms layout burst reads
//! `pending` at a 200 ms deadline and `settled` at 1 s, the wait ending on the burst's
//! notifications and the fake clock moving only to the events and the deadline.

use omo_computer_core::results::WaitOutcome;
use serde_json::{json, Value};

use super::{params, Rig};

fn burst() -> Value {
    let events: Vec<Value> = (0..=8)
        .map(|i| json!({"t_ms": i * 50, "window": "101", "kind": "AXLayoutChanged"}))
        .collect();
    json!({ "ax_notification_timeline": events })
}

#[test]
fn settle_burst_pending_then_settled() {
    for (deadline, outcome, waited) in [
        (200, WaitOutcome::Pending, 200),
        (1_000, WaitOutcome::Settled, 900),
    ] {
        let mut rig = Rig::new(burst());
        let call = json!({"target": "101", "predicate": {"settle": {"timeoutMs": deadline}}});
        let result = rig.session.wait_for(params(call)).expect("waitFor");
        assert_eq!(result.outcome, outcome, "deadline {deadline} ms");
        let settle = result.observation.settle.expect("the settle the wait ran");
        assert_eq!(settle.waited_ms, waited, "deadline {deadline} ms");
    }
}
