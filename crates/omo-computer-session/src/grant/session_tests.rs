//! Consent, the foreground lease and window reservations through `Session`, on the fake. The
//! two-session legs use two INDEPENDENT sessions on one shared RUNTIME root (R23).

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::paths::Roots;
use serde_json::{json, Value};

use crate::consent::Part;
use crate::{Refused, Session};

const SCENARIO: &str = r#"{"displays":[{"id":"1","name":"Built-in Display","x":0,"y":0,"width":1920,"height":1080,"scale":1.0,"pixelX":0,"pixelY":0,"pixelWidth":1920,"pixelHeight":1080,"isPrimary":true}],"windows":[
  {"id":"1","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":100,"height":100,"focused":true,"elevated":null},
  {"id":"2","title":"u","app":"Mail","pid":4343,"x":200,"y":0,"width":100,"height":100,"focused":false,"elevated":null}]}"#;

pub(super) fn scenario(extra: &Value) -> FakeScenario {
    let mut value: Value = serde_json::from_str(SCENARIO).expect("scenario json");
    if let (Some(base), Some(more)) = (value.as_object_mut(), extra.as_object()) {
        base.extend(more.iter().filter(|(key, _)| *key != "object").map(|(k, v)| (k.clone(), v.clone())));
    }
    FakeScenario::from_value(&value).expect("scenario")
}

pub(super) fn session(extra: &Value, sink: &RecordingSink, roots: Option<(&Path, &str)>) -> Session {
    let backend = FakeBackend::with_parts(scenario(extra), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = match roots {
        None => Session::new(Box::new(backend)),
        Some((dir, name)) => Session::for_roots(
            Box::new(backend),
            &Roots {
                state: dir.join(name),
                runtime: dir.join("run"),
            },
        ),
    };
    let report = if extra.get("object").is_some() { "object" } else { "null" };
    session.open(params(json!({ "reportMode": report }))).expect("open");
    session.stop_path_start(params(json!({})));
    session
}

pub(super) fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params")
}

pub(super) fn reason(result: &Result<impl std::fmt::Debug, Refused>) -> Option<(&'static str, Option<&'static str>)> {
    result.as_ref().err().map(|r| (r.refusal.code.wire(), r.refusal.reason))
}

fn grant(session: &mut Session) {
    session.control_grant(params(json!({ "reason": "test", "confirmationId": "c-1" })));
}

/// Row 20: a click maps through the target's newest captured frame, so tests capture first.
pub(super) fn capture(session: &mut Session, target: &str) {
    session.capture(params(json!({ "target": target }))).expect("capture");
}

fn desktop_click(session: &mut Session) -> Result<omo_computer_core::results::ExecReply, Refused> {
    session.click(params(json!({ "target": "desktop", "x": 5, "y": 5 })))
}

#[test]
fn denied_prompt_is_not_reasked_until_newer_user_message() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({}), &sink, None);
    assert_eq!(reason(&desktop_click(&mut s)), Some(("ControlRequired", None)), "asks for the grant");
    s.record_denial(Part::Foreground, None);
    assert_eq!(reason(&desktop_click(&mut s)), Some(("ControlRequired", Some("denied_this_turn"))));
    assert_eq!(reason(&desktop_click(&mut s)), Some(("ControlRequired", Some("denied_this_turn"))));
    s.user_message();
    assert_eq!(reason(&desktop_click(&mut s)), Some(("ControlRequired", None)), "asks again");
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

#[test]
fn foreground_lease_single_holder() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (sink_a, sink_b) = (RecordingSink::default(), RecordingSink::default());
    let mut a = session(&json!({}), &sink_a, Some((dir.path(), "a")));
    let mut b = session(&json!({}), &sink_b, Some((dir.path(), "b")));
    grant(&mut a);
    grant(&mut b);
    assert!(a.control_acquire().is_ok());
    assert_eq!(reason(&a.control_acquire()), Some(("InputBusy", None)), "never taken twice");
    let busy = b.control_acquire().expect_err("held by a");
    assert_eq!(busy.refusal.code.wire(), "InputBusy");
    assert!(busy.detail.as_ref().is_some_and(|d| d["holder"]["sessionId"].is_string()));
    assert_eq!(reason(&desktop_click(&mut b)), Some(("InputBusy", None)));
    assert!(sink_b.lines().iter().all(|line| !line.contains("pointer")), "{:?}", sink_b.lines());
    capture(&mut a, "desktop");
    assert!(desktop_click(&mut a).is_ok(), "the holder clicks");
    a.close();
    assert!(b.control_acquire().is_ok(), "a closed session frees the slot");
}

#[test]
fn full_access_desktop_click_needs_no_prompt_and_a_window_target_stays_background() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({ "full_access_preset": true }), &sink, None);
    capture(&mut s, "desktop");
    assert!(desktop_click(&mut s).is_ok());
    assert!(s.holds_lease());
    assert!(sink.lines().iter().any(|line| line.contains("presence show")), "{:?}", sink.lines());
    let mut plain = session(&json!({}), &RecordingSink::default(), None);
    assert_eq!(reason(&desktop_click(&mut plain)), Some(("ControlRequired", None)));
    capture(&mut plain, "1");
    assert!(plain.click(params(json!({ "target": "1", "x": 1, "y": 1 }))).is_ok(), "background needs no grant");
}

#[test]
fn window_held_by_other_session_is_input_busy() {
    let dir = tempfile::tempdir().expect("tempdir");
    let now = Arc::new(AtomicU64::new(1_000));
    let clock = {
        let now = now.clone();
        Arc::new(move || now.load(Ordering::SeqCst)) as crate::grant::MachineClock
    };
    let (sink_a, sink_b) = (RecordingSink::default(), RecordingSink::default());
    let mut a = session(&json!({}), &sink_a, Some((dir.path(), "a"))).with_clock(clock.clone());
    let mut b = session(&json!({}), &sink_b, Some((dir.path(), "b"))).with_clock(clock.clone());
    let typed = |s: &mut Session| s.type_text(params(json!({ "target": "1", "text": "hi" })));
    assert!(typed(&mut a).is_ok());
    let busy = typed(&mut b).expect_err("a holds window 1");
    assert_eq!((busy.refusal.code.wire(), busy.refusal.reason), ("InputBusy", Some("window")));
    let detail = busy.detail.expect("detail");
    assert_eq!(detail["window"], json!("1"));
    assert_eq!(detail["retryAfterMs"], json!(10_000));
    assert!(detail["holder"]["sessionId"].is_string());
    assert!(sink_b.is_empty(), "{:?}", sink_b.lines());
    assert!(b.type_text(params(json!({ "target": "2", "text": "x" }))).is_ok(), "another window");
    now.fetch_add(10_000, Ordering::SeqCst);
    assert!(typed(&mut b).is_ok(), "after a's report + 10,000 ms");
    let mut c = session(&json!({}), &RecordingSink::default(), Some((dir.path(), "c"))).with_clock(clock);
    assert_eq!(reason(&typed(&mut c)), Some(("InputBusy", Some("window"))));
    b.close();
    assert!(typed(&mut c).is_ok(), "closing the owner frees the window");
}

#[test]
fn stop_is_exempt_from_consent_off_and_a_consent_off_hand_still_latches() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({ "consent": { "computerUse": false } }), &sink, None);
    let click = |s: &mut Session| s.click(params(json!({ "target": "1", "x": 1, "y": 1 })));
    assert_eq!(reason(&click(&mut s)), Some(("ControlRequired", Some("consent_off"))));
    let status = s.stop_path_stop(params(json!({ "source": "user" })));
    assert!(status.suspended, "the stop latches on a consent-off hand");
    assert_eq!(reason(&click(&mut s)).map(|(code, _)| code), Some("Suspended"));
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

#[test]
fn unbound_scope_name_refused_at_open() {
    let backend = FakeBackend::new(scenario(&json!({ "consent": { "scope": ["NoSuchApp"] } })));
    let mut s = Session::new(Box::new(backend));
    let refused = s.open(params(json!({}))).expect_err("no app binds");
    assert_eq!((refused.code.wire(), refused.reason), ("InvalidTarget", Some("app_unknown")));
    let bound = FakeBackend::new(scenario(&json!({ "consent": { "scope": ["notes"] } })));
    let mut s = Session::new(Box::new(bound));
    assert!(s.open(params(json!({}))).is_ok());
    assert_eq!(s.consent().view().scope, Some(vec!["Notes".to_owned()]));
}

#[test]
fn only_global_input_on_the_desktop_takes_the_lease_and_reserves_every_window() {
    use omo_computer_core::backend::Route;
    use omo_computer_core::methods::Method;
    use omo_computer_safety::TargetRef;
    let mut backend = FakeBackend::new(scenario(&json!({})));
    let mut control = crate::grant::Control::default();
    let click = control.plan(&mut backend, (Method::Click, &TargetRef::Desktop, Route::BackgroundWindow), 0);
    assert!(click.foreground);
    assert_eq!(click.windows, ["1", "2"]);
    let launch = control.plan(&mut backend, (Method::AppsOpen, &TargetRef::Desktop, Route::BackgroundPid), 0);
    assert!(!launch.foreground, "a launch lands on no pointer");
    assert!(launch.windows.is_empty(), "and reserves no window");
    let foreground = control.plan(&mut backend, (Method::AppsOpen, &TargetRef::Desktop, Route::ForegroundHid), 0);
    assert!(foreground.foreground, "a foreground route still needs the lease");
}

/// Review M3 of #13346: an app whose identity cannot be read is bound to its executable PATH.
/// The funnel must observe that path (not None), refuse a different executable under the same
/// app key, and carry `identity_unavailable` on the report of an admitted call.
#[test]
fn path_only_consent_binds_the_observed_executable_path() {
    let view = json!({ "consent": { "apps": { "allow": [{ "appKey": "Notes", "path": "/usr/bin/notes" }] } } });
    let mut moved = view.clone();
    moved["executable_path"] = json!({ "4242": "/tmp/evil/notes" });
    let mut same = view;
    same["executable_path"] = json!({ "4242": "/usr/bin/notes" });

    let sink = RecordingSink::default();
    let mut s = session(&moved, &sink, None);
    grant(&mut s);
    capture(&mut s, "1");
    let refused = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect_err("another executable");
    assert_eq!(
        (refused.refusal.code.wire(), refused.refusal.reason),
        ("ControlRequired", Some("identity_changed"))
    );
    assert!(sink.is_empty(), "nothing sent: {:?}", sink.lines());

    let mut object = same;
    object["object"] = json!(true);
    let mut s = session(&object, &RecordingSink::default(), None);
    grant(&mut s);
    capture(&mut s, "1");
    let reply = s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect("the approved path");
    assert_eq!(serde_json::to_value(&reply).expect("report")["warning"], json!("identity_unavailable"));
}

/// A-IS-61 Q5 through the funnel: an admitted call's audit line records how its entry was bound.
#[test]
fn audit_line_records_the_binding_of_an_admitted_call() {
    let run = |entry: Value, extra: Value| -> Value {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut scenario = json!({ "consent": { "apps": { "allow": [entry] } } });
        if let (Some(base), Some(more)) = (scenario.as_object_mut(), extra.as_object()) {
            base.extend(more.clone());
        }
        let mut s = session(&scenario, &RecordingSink::default(), Some((dir.path(), "a")));
        grant(&mut s);
        capture(&mut s, "1");
        s.click(params(json!({ "target": "1", "x": 5, "y": 5 }))).expect("admitted");
        let text = std::fs::read_to_string(dir.path().join("a/audit/computer/local/audit.jsonl")).expect("audit");
        let last = text.lines().filter(|l| l.contains("\"click\"") || l.contains("click")).last().expect("a click line").to_owned();
        serde_json::from_str(&last).expect("json")
    };
    let path = run(json!({ "appKey": "Notes", "path": "/usr/bin/notes" }), json!({ "executable_path": { "4242": "/usr/bin/notes" } }));
    assert_eq!(path["appBinding"]["binding"], "path", "{path}");
    assert!(path["warnings"].as_array().is_some_and(|w| w.contains(&json!("identity_unavailable"))), "{path}");
    let ident = json!({ "teamId": "T1", "cdhash": "aa" });
    let id = run(json!({ "appKey": "Notes", "identity": ident }), json!({ "code_identity": { "4242": ident } }));
    assert_eq!(id["appBinding"]["binding"], "identity", "{id}");
    assert_eq!(id["appBinding"]["identitySha256_16"].as_str().map(str::len), Some(16), "{id}");
}
