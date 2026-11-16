//! Row 50 (R62) end to end on the fake: a deaf listener refuses every exec whatever the stop
//! policy, and the physical lease-end key ends the foreground lease through the one funnel,
//! the R45 hook hearing it once.

use std::sync::{Arc, Mutex};

use omo_computer_backend_fake::{FakeBackend, FakeClock, RecordingSink, StopPathScript};
use omo_computer_core::backend::Backend;
use serde_json::json;

use super::session_tests::{capture, params, reason, scenario};
use super::LeaseHook;
use crate::presence::LeaseEnd;
use crate::Session;

fn backend(stop: StopPathScript, sink: &RecordingSink) -> FakeBackend {
    FakeBackend::with_parts(
        scenario(&json!({ "object": true })),
        FakeClock::default(),
        sink.clone(),
    )
    .with_stop_path(stop)
}

struct Heard(Arc<Mutex<Vec<LeaseEnd>>>);

impl LeaseHook for Heard {
    fn lease_ended(&mut self, _backend: &mut dyn Backend, why: LeaseEnd) {
        self.0.lock().expect("heard").push(why);
    }
}

#[test]
fn a_scripted_deaf_listener_refuses_every_exec_under_any_policy() {
    for relay_only in [false, true] {
        let sink = RecordingSink::default();
        let mut s = Session::new(Box::new(backend(StopPathScript::Deaf, &sink)));
        s.open(params(
            json!({ "reportMode": "object", "allowHostRelayOnlyStop": relay_only }),
        ))
        .expect("open");
        s.stop_path_heartbeat();
        s.stop_path_start(params(json!({})));
        s.control_grant(params(json!({ "reason": "r" })));
        capture(&mut s, "1");
        let click = s.click(params(json!({ "target": "1", "x": 1, "y": 1 })));
        assert_eq!(
            reason(&click),
            Some(("StopPathUnavailable", Some("deaf"))),
            "relay_only={relay_only}"
        );
        assert!(
            !sink
                .lines()
                .iter()
                .any(|line| line.starts_with("post_input")),
            "{:?}",
            sink.lines()
        );
    }
}

#[test]
fn the_lease_end_key_ends_the_foreground_lease_once_through_the_hook() {
    let sink = RecordingSink::default();
    let fake = backend(StopPathScript::Live, &sink);
    let keys = fake.handle();
    let mut s = Session::new(Box::new(fake));
    s.open(params(json!({ "reportMode": "object" })))
        .expect("open");
    let heard = Arc::new(Mutex::new(Vec::new()));
    s.set_lease_hook(Box::new(Heard(Arc::clone(&heard))));
    s.stop_path_start(params(json!({})));
    s.control_grant(params(json!({ "reason": "r" })));
    capture(&mut s, "desktop");
    capture(&mut s, "1");
    s.click(params(json!({ "target": "desktop", "x": 5, "y": 5 })))
        .expect("foreground click");
    assert!(s.holds_lease());

    keys.press_lease_end();
    let next = s
        .click(params(json!({ "target": "1", "x": 1, "y": 1 })))
        .expect("the run continues");
    let report = serde_json::to_value(&next).expect("report");
    assert_eq!(report["focusRestoration"], json!("user_moved_on"));
    assert!(
        !s.stop_path_status().suspended,
        "Escape ends the lease, it is not a stop"
    );
    assert!(
        sink.lines()
            .iter()
            .any(|line| line.contains("presence hide")),
        "{:?}",
        sink.lines()
    );
    assert_eq!(*heard.lock().expect("heard"), vec![LeaseEnd::UserEsc]);

    keys.press_lease_end();
    s.click(params(json!({ "target": "1", "x": 1, "y": 1 })))
        .expect("no lease to end");
    assert_eq!(
        heard.lock().expect("heard").len(),
        1,
        "an Escape with no lease ends nothing"
    );
}


/// Review M1 at 77a028eea1 (R70aa(4)): on X11 the lease-end key is heard only when the stop
/// listener is polled. An Escape pressed between two calls ends the lease before the next call's
/// plan, so that call already reports `user_moved_on` and takes no lease.
#[test]
fn an_escape_heard_at_the_listener_poll_ends_the_lease_before_the_next_plan() {
    let sink = RecordingSink::default();
    let fake = backend(StopPathScript::Live, &sink);
    let keys = fake.handle();
    let mut s = Session::new(Box::new(fake));
    s.open(params(json!({ "reportMode": "object" })))
        .expect("open");
    let heard = Arc::new(Mutex::new(Vec::new()));
    s.set_lease_hook(Box::new(Heard(Arc::clone(&heard))));
    s.stop_path_start(params(json!({})));
    s.control_grant(params(json!({ "reason": "r" })));
    capture(&mut s, "desktop");
    capture(&mut s, "1");
    s.click(params(json!({ "target": "desktop", "x": 5, "y": 5 })))
        .expect("foreground click");
    assert!(s.holds_lease());

    keys.press_lease_end_through_listener();
    let next = s
        .click(params(json!({ "target": "1", "x": 1, "y": 1 })))
        .expect("the run continues");
    let report = serde_json::to_value(&next).expect("report");
    assert_eq!(report["focusRestoration"], json!("user_moved_on"), "{report}");
    assert_eq!(*heard.lock().expect("heard"), vec![LeaseEnd::UserEsc]);
    assert!(!s.holds_lease());
}

/// Review M1's second case: an Escape heard while no lease exists ends nothing, then or later.
#[test]
fn an_escape_with_no_lease_never_ends_the_lease_taken_after_it() {
    let sink = RecordingSink::default();
    let fake = backend(StopPathScript::Live, &sink);
    let keys = fake.handle();
    let mut s = Session::new(Box::new(fake));
    s.open(params(json!({ "reportMode": "object" })))
        .expect("open");
    let heard = Arc::new(Mutex::new(Vec::new()));
    s.set_lease_hook(Box::new(Heard(Arc::clone(&heard))));
    s.stop_path_start(params(json!({})));
    s.control_grant(params(json!({ "reason": "r" })));
    capture(&mut s, "desktop");
    capture(&mut s, "1");

    keys.press_lease_end_through_listener();
    s.click(params(json!({ "target": "desktop", "x": 5, "y": 5 })))
        .expect("foreground click");
    s.click(params(json!({ "target": "1", "x": 1, "y": 1 })))
        .expect("background click");
    assert!(s.holds_lease(), "the Escape came before the lease");
    assert!(heard.lock().expect("heard").is_empty());
}


/// A-IS-62 fixture case (iv), R70an(B): a consent view without the stop key arms nothing and the
/// stop path reads deaf with `deafReason: "chord-unarmable"`, never absent.
#[test]
fn a_view_without_the_stop_key_reads_deaf_chord_unarmable() {
    let backend = FakeBackend::with_parts(
        scenario(&json!({ "consent": { "apps": {} }, "stopHotkeyNotCarried": true })),
        FakeClock::default(),
        RecordingSink::default(),
    )
    .with_stop_path(StopPathScript::Live);
    let mut s = Session::new(Box::new(backend));
    s.open(params(json!({ "reportMode": "object" })))
        .expect("open");
    let refused = s
        .stop_path_start_checked(params(json!({})))
        .expect_err("nothing armed");
    assert_eq!((refused.code.wire(), refused.reason), ("StopPathUnavailable", Some("deaf")));
    let capabilities = serde_json::to_string(&s.capabilities()).expect("capabilities");
    assert!(capabilities.contains(r#""deaf":true"#), "{capabilities}");
    assert!(capabilities.contains(r#""deafReason":"chord-unarmable""#), "{capabilities}");
}
