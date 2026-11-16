//! The review of #13355 at 749dc9d54c: a refusal after a takeover re-check wait reports that wait
//! (L3), and a re-check that took no time keeps the takeover check on the next pass (L4).

use super::review_b3227b5::{key_inputs, Scripted, BUSY_UNTIL_300};
use super::*;

/// L3: the gate refuses `Suspended` after the re-check waited about 300 ms; `paused` says so.
#[test]
fn l3_a_gate_refusal_after_a_recheck_wait_carries_the_wait() {
    let (inner, sink) = fake(&format!(r#",{BUSY_UNTIL_300},{}"#, key_inputs([100])));
    let backend = Scripted {
        stop_at_ms: Some(600),
        ..Scripted::new(inner)
    };
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("the stop latched during the re-check wait");
    assert_eq!(refused.refusal.code.wire(), "Suspended", "{refused:?}");
    assert!(
        refused
            .stamps
            .paused
            .iter()
            .any(|p| p.reason == PauseReason::UserActive && p.ms > 0),
        "the refusal reports the re-check wait: {:?}",
        refused.stamps.paused
    );
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

/// L3: the attribution hold refuses after the re-check waited about 1 s; `paused` says so.
#[test]
fn l3_an_attribution_refusal_after_a_recheck_wait_carries_the_wait() {
    let (inner, sink) = fake(&format!(
        r#",{BUSY_UNTIL_300},{}"#,
        key_inputs([100].into_iter().chain((1_000..=2_000).step_by(10)))
    ));
    let backend = Scripted {
        away_at_ms: Some(1_300),
        ..Scripted::new(inner)
    };
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("the input right before the send holds it");
    assert_eq!(wire(&refused), ("UserIntervened", None), "{refused:?}");
    assert!(
        refused
            .stamps
            .paused
            .iter()
            .any(|p| p.reason == PauseReason::UserActive && p.ms >= 900),
        "the refusal reports the re-check wait: {:?}",
        refused.stamps.paused
    );
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

/// L4: the takeover hold reads active, then off on the re-check's first tick (a flicker), then
/// active again. The next pass checks it again and waits, instead of sending at once.
#[test]
fn l4_a_recheck_that_took_no_time_keeps_the_takeover_check_on_the_next_pass() {
    let (inner, sink) = fake(&format!(r#",{BUSY_UNTIL_300},{}"#, key_inputs([100])));
    let clock = inner.clock();
    let backend = Scripted {
        away_read: Some((300, 2)),
        ..Scripted::new(inner)
    };
    let reply = object_session(Box::new(backend))
        .framed_click(None)
        .expect("sent once the user paused");
    let paused = report(reply).paused().to_vec();
    assert!(
        paused.iter().any(|p| p.reason == PauseReason::UserActive),
        "the next pass waited for the user: {paused:?}"
    );
    assert!(
        clock.now_ms() >= 1_600,
        "not delivered while the user was active: {}",
        clock.now_ms()
    );
    assert_eq!(sink.len(), 3, "{:?}", sink.lines());
}
