//! The battery's whole wait runs on fake time: its deadline as well as its
//! polls. An element that never becomes ready is refused after exactly
//! `AUTO_WAIT` of fake time; a deadline read from the host clock would spin
//! the fake clock far past it, or never move it at all.

use senpi_desktop_core::report::Disposition;
use serde_json::json;

use super::{button, opened_on_fake_time, press, pressed, report, scene};
use crate::actionability::AUTO_WAIT;

#[test]
fn the_battery_gives_up_after_exactly_auto_wait_of_fake_time() {
    // Given: an element that stays hidden far longer than the battery waits.
    let mut harness = opened_on_fake_time(&scene(button(&json!({"ready_after_ms": 600_000})), &[]));
    let reference = harness.focused_ref();
    // When
    let error = press(&mut harness, reference).expect_err("refused once the wait runs out");
    // Then: refused as not visible, after AUTO_WAIT of fake time to the millisecond.
    let refusal = report(&error);
    assert_eq!(refusal.reason.as_deref(), Some("not_visible"));
    assert_eq!(refusal.disposition, Some(Disposition::NOT_DELIVERED_SAFE));
    let waited = u128::from(harness.fake_ms());
    assert_eq!(
        waited,
        AUTO_WAIT.as_millis(),
        "the battery waited {waited} ms of fake time"
    );
    assert_eq!(pressed(&harness), 0);
}
