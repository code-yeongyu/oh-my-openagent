//! The wire bytes the router answers (moved with the dispatch from rpc.rs, row 28).

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;
use omo_computer_session::Session;
use serde_json::{json, Value};

use super::refusals::{refused, refused_call};
use super::{Peer, Router, RouterContext, WireError};
use crate::launch::host_less_view;

fn router_over(backend: FakeBackend, clock: Option<FakeClock>) -> Router {
    let ctx = RouterContext {
        test_clock: clock.is_some(),
        fake_clock: clock,
        machine_key: Vec::new(),
        host: Box::new(host_less_view),
    };
    Router::new(Session::new(Box::new(backend)), ctx)
}

fn data(outcome: Result<Value, WireError>) -> Value {
    outcome.expect_err("refused").data.unwrap_or_default()
}

#[test]
fn exec_without_a_session_answers_the_closed_row() {
    let mut router = router_over(FakeBackend::from_json("{}").expect("empty"), None);
    let refused = router.call(Peer::Host, "typeText", json!({"target": "1", "text": "x"})).expect_err("closed");
    assert_eq!(refused.code, EngineCode::Closed.number());
    assert_eq!(refused.data, Some(json!({ "code": "Closed", "hint": null })));
}

#[test]
fn params_that_do_not_fit_answer_invalid_params() {
    let mut router = router_over(FakeBackend::from_json("{}").expect("empty"), None);
    let bad = router.call(Peer::Host, "click", json!({"x": "one"})).expect_err("invalid");
    assert_eq!(bad.code, super::INVALID_PARAMS);
}

#[test]
fn an_interrupted_call_carries_its_disposition_on_the_wire() {
    let interrupted = omo_computer_session::Refused {
        call_id: Some("k-1".to_owned()),
        interrupted: Some(omo_computer_core::report::Disposition::UNCERTAIN_UNSAFE),
        warning: Some("write_failed".to_owned()),
        ..Refusal::new(EngineCode::TransactionFailed, omo_computer_core::error::Reason::RecoveryRequired).into()
    };
    let data = refused_call(&interrupted).data.expect("data");
    assert_eq!(data["warning"], json!("write_failed"), "an unwritten audit line is surfaced");
    assert_eq!(data["callId"], json!("k-1"));
    assert_eq!(data["disposition"], json!({ "delivery": "delivery_uncertain", "retry": "unsafe" }));
    let plain = refused_call(&Refusal::new(EngineCode::TransactionFailed, omo_computer_core::error::Reason::MarkerUnavailable).into());
    assert!(plain.data.expect("data").get("disposition").is_none(), "a refusal before any send carries none");
}

const NOTES: &str = r#""windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]"#;
const LOCKED: &str = r#","session_timeline":[{"t_ms":0,"screen_locked":true}]"#;
const INTERRUPTED: &str = r#","typing_unit_ms":10,"user_input_timeline":[{"t_ms":25,"pid":4242,"kind":"key"}]"#;

fn opened(extra: &str, open: &Value) -> Router {
    let scenario = FakeScenario::from_json(&format!("{{{NOTES}{extra}}}")).expect("scenario");
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), RecordingSink::default())
        .with_stop_path(StopPathScript::Live);
    let mut router = router_over(backend, None);
    router.call(Peer::Host, "session.open", open.clone()).expect("open");
    router.call(Peer::Host, "stopPath.start", json!({})).expect("armed");
    router
}

fn click(router: &mut Router) -> Result<Value, WireError> {
    router.call(Peer::Host, "click", json!({"target": "101", "x": 10, "y": 10}))
}

fn type_text(router: &mut Router) -> Result<Value, WireError> {
    router.call(Peer::Host, "typeText", json!({"target": "101", "text": "abcdefghij"}))
}

#[test]
fn null_mode_refusals_keep_the_v1_bytes() {
    let locked = data(click(&mut opened(LOCKED, &json!({}))));
    assert_eq!(locked, json!({ "code": "ScreenLocked", "hint": null, "reason": "screen_locked" }));
    let mut interrupted = data(type_text(&mut opened(INTERRUPTED, &json!({}))));
    assert!(interrupted["callId"].is_string(), "{interrupted}");
    interrupted.as_object_mut().expect("data").remove("callId");
    assert_eq!(interrupted, json!({ "code": "UserIntervened", "hint": null }));
}

#[test]
fn object_mode_refusals_carry_delivered_paused_and_session() {
    let object = json!({"reportMode": "object"});
    let locked = data(click(&mut opened(LOCKED, &object)));
    assert_eq!(locked["paused"], json!([{ "reason": "screen_locked", "ms": 120_001 }]));
    assert_eq!(locked["session"]["screenLocked"], json!(true));
    assert!(locked.get("delivered").is_none(), "nothing was sent: {locked}");
    let interrupted = data(type_text(&mut opened(INTERRUPTED, &object)));
    assert_eq!(interrupted["delivered"], json!({ "count": 3, "of": 10 }));
}

#[test]
fn a_reasoned_refusal_carries_its_reason() {
    let refusal = Refusal::new(EngineCode::InvalidTarget, omo_computer_core::error::Reason::DragDestination);
    assert!(refusal.computer_code().is_ok(), "the pair has a table row");
    let wire = refused(&refusal);
    assert_eq!(wire.code, EngineCode::InvalidTarget.number());
    assert_eq!(wire.data, Some(json!({ "code": "InvalidTarget", "hint": null, "reason": "drag_destination" })));
}

#[test]
fn engine_hello_answers_the_v1_members() {
    let mut router = router_over(FakeBackend::from_json("{}").expect("empty"), None);
    let hello = router.call(Peer::Host, "engine.hello", json!({})).expect("hello");
    assert_eq!((hello["protocolVersion"].clone(), hello["abi"].clone()), (json!("1"), json!("omo-computer/1")));
}

#[test]
fn the_test_clock_moves_only_under_its_seam() {
    let clock = FakeClock::default();
    let mut router = router_over(FakeBackend::from_json("{}").expect("empty"), Some(clock.clone()));
    router.call(Peer::Host, "$/test.advanceClock", json!({"ms": 2100})).expect("advanced");
    assert_eq!(clock.now_ms(), 2100);
    let mut unseamed = router_over(FakeBackend::from_json("{}").expect("empty"), None);
    let refused = unseamed.call(Peer::Host, "$/test.advanceClock", json!({"ms": 1})).expect_err("test only");
    assert_eq!(refused.data, Some(json!({"reason": "testOnly"})));
}

#[test]
fn a_stop_and_its_start_notify_the_new_status() {
    let mut router = opened("", &json!({}));
    router.take_notifications();
    router.call(Peer::Host, "stopPath.stop", json!({"source": "api"})).expect("stopped");
    let notes = router.take_notifications();
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert_eq!((notes[0]["method"].clone(), notes[0]["params"]["suspended"].clone()), (json!("stopPath.changed"), json!(true)));
    assert_eq!(router.stop_epoch(), 1);
}

#[test]
fn a_wrong_resume_token_is_permission_denied() {
    let mut router = opened("", &json!({}));
    router.call(Peer::Host, "stopPath.stop", json!({"source": "api"})).expect("stopped");
    let refused = router.call(Peer::Host, "stopPath.resume", json!({"token": "wrong"})).expect_err("denied");
    assert_eq!(refused.code, EngineCode::PermissionDenied.number());
}

// Ported from rows 21-26's rpc/tests.rs (R60c), now against the router's refusal wire.
fn drag_refused(stage: Value) -> Value {
    let refused = omo_computer_session::Refused {
        detail: Some(Box::new(stage)),
        ..Refusal::new(EngineCode::InvalidTarget, omo_computer_core::error::Reason::DragDestination).into()
    };
    refused_call(&refused).data.expect("data")
}

fn own_row(code: EngineCode, reason: Option<&str>) -> Value {
    let row = omo_computer_core::error::from_wire(code.number(), reason).expect("a row");
    match row.disposition {
        omo_computer_core::error::DispositionRule::Fixed(d)
        | omo_computer_core::error::DispositionRule::BySent { nothing: d, .. } => json!(d),
        _ => Value::Null,
    }
}

#[test]
fn a_refused_drag_point_takes_its_stage_pairs_own_disposition() {
    for (code, reason) in [
        (EngineCode::ControlRequired, Some("denied_app")),
        (EngineCode::ControlRequired, Some("app_scope")),
        (EngineCode::ProtectedProcess, Some("self_target")),
        (EngineCode::InvalidTarget, Some("protected_surface")),
        (EngineCode::BackgroundUnavailable, Some("target_unknown")),
        (EngineCode::ScreenLocked, None),
    ] {
        let mut stage = json!({"point": {"x": 1.0, "y": 2.0}, "stageCode": code.wire()});
        if let Some(reason) = reason {
            stage["stageReason"] = json!(reason);
        }
        let data = drag_refused(stage);
        assert_eq!((&data["code"], &data["reason"]), (&json!("InvalidTarget"), &json!("drag_destination")));
        assert_eq!(data["disposition"], own_row(code, reason), "{code:?} {reason:?}: {data}");
    }
}

#[test]
fn every_other_refusal_keeps_its_wire_form() {
    use omo_computer_core::error::Reason;
    let before = json!({"code": "ControlRequired", "hint": null, "reason": "denied_app"});
    let plain = refused_call(&Refusal::new(EngineCode::ControlRequired, Reason::DeniedApp).into());
    assert_eq!(plain.data.expect("data"), before, "no disposition or nextCall is added");
    let drag_without_stage = drag_refused(json!({"point": {"x": 1.0, "y": 2.0}}));
    assert!(drag_without_stage.get("disposition").is_none() && drag_without_stage.get("nextCall").is_none());
}
