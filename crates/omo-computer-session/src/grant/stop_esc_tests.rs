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
