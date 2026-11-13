//! The JSON-RPC framing and refusal-wire tests (moved from rpc/mod.rs, R65: no change).

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink};
use omo_computer_core::backend::{Backend, Refusal};
use omo_computer_core::error::EngineCode;
use serde_json::{json, Value};

use super::*;

fn session() -> Session {
    let backend: Box<dyn Backend> = Box::new(FakeBackend::from_json("{}").expect("empty scenario"));
    Session::new(backend)
}

fn call(session: &mut Session, line: &str) -> Value {
    let reply = handle_line(session, line.as_bytes()).expect("a reply");
    serde_json::from_str(&reply).expect("reply is JSON")
}

#[test]
fn framing_errors_answer_their_codes() {
    let mut session = session();
    assert_eq!(call(&mut session, "not json")["error"]["code"], json!(PARSE_ERROR));
    assert_eq!(call(&mut session, "[1]")["error"]["code"], json!(INVALID_REQUEST));
    let unknown = call(&mut session, r#"{"jsonrpc":"2.0","id":7,"method":"nope"}"#);
    assert_eq!((unknown["id"].clone(), unknown["error"]["code"].clone()), (json!(7), json!(METHOD_NOT_FOUND)));
    let bad = call(&mut session, r#"{"jsonrpc":"2.0","id":"a","method":"click","params":{"x":"one"}}"#);
    assert_eq!((bad["id"].clone(), bad["error"]["code"].clone()), (json!("a"), json!(INVALID_PARAMS)));
    assert_eq!(handle_line(&mut session, br#"{"jsonrpc":"2.0","method":"capabilities"}"#), None);
    assert_eq!(call(&mut session, "{}")["error"]["code"], json!(INVALID_REQUEST));
}

#[test]
fn id_less_requests_reach_nothing_and_get_no_reply() {
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::default(), FakeClock::default(), sink.clone());
    let mut session = Session::new(Box::new(backend));
    call(&mut session, r#"{"jsonrpc":"2.0","id":1,"method":"session.open","params":{}}"#);
    for line in [
        r#"{"jsonrpc":"2.0","method":"click","params":{"target":"1","x":1,"y":1}}"#,
        r#"{"jsonrpc":"2.0","method":"typeText","params":{"target":"1","text":"hi"}}"#,
        r#"{"jsonrpc":"2.0","method":"$/cancel","params":{"id":1}}"#,
    ] {
        assert_eq!(handle_line(&mut session, line.as_bytes()), None, "{line}");
    }
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

#[test]
fn exec_without_a_session_answers_the_closed_row() {
    let mut session = session();
    let reply = call(&mut session, r#"{"jsonrpc":"2.0","id":1,"method":"typeText","params":{"target":"1","text":"x"}}"#);
    let error = &reply["error"];
    assert_eq!(error["code"], json!(EngineCode::Closed.number()));
    assert_eq!(error["data"], json!({ "code": "Closed", "hint": null }));
}

#[test]
fn an_interrupted_call_carries_its_disposition_on_the_wire() {
    let interrupted = omo_computer_session::Refused {
        call_id: Some("k-1".to_owned()),
        interrupted: Some(omo_computer_core::report::Disposition::UNCERTAIN_UNSAFE),
        warning: Some("write_failed".to_owned()),
        ..Refusal::new(EngineCode::TransactionFailed, "recovery_required").into()
    };
    let Failure { data, .. } = refused_call(&interrupted);
    let data = data.expect("data");
    assert_eq!(data["warning"], json!("write_failed"), "an unwritten audit line is surfaced");
    assert_eq!(data["callId"], json!("k-1"));
    assert_eq!(data["disposition"], json!({ "delivery": "delivery_uncertain", "retry": "unsafe" }));
    let plain = refused_call(&Refusal::new(EngineCode::TransactionFailed, "marker_unavailable").into());
    assert!(plain.data.expect("data").get("disposition").is_none(), "a refusal before any send carries none");
}

fn drag_refused(stage: Value) -> Value {
    let refused = omo_computer_session::Refused {
        detail: Some(Box::new(stage)),
        ..Refusal::new(EngineCode::InvalidTarget, "drag_destination").into()
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
    let before = json!({"code": "ControlRequired", "hint": null, "reason": "denied_app"});
    let plain = refused_call(&Refusal::new(EngineCode::ControlRequired, "denied_app").into());
    assert_eq!(plain.data.expect("data"), before, "no disposition or nextCall is added");
    let drag_without_stage = drag_refused(json!({"point": {"x": 1.0, "y": 2.0}}));
    assert!(drag_without_stage.get("disposition").is_none() && drag_without_stage.get("nextCall").is_none());
}

const NOTES: &str = r#""windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]"#;

fn opened(extra: &str, open: &str) -> Session {
    let scenario = FakeScenario::from_json(&format!("{{{NOTES}{extra}}}")).expect("scenario");
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), RecordingSink::default())
        .with_stop_path(omo_computer_backend_fake::StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    call(&mut session, &format!(r#"{{"jsonrpc":"2.0","id":1,"method":"session.open","params":{open}}}"#));
    call(&mut session, r#"{"jsonrpc":"2.0","id":2,"method":"stopPath.start","params":{}}"#);
    session
}

const LOCKED: &str = r#","session_timeline":[{"t_ms":0,"screen_locked":true}]"#;
const INTERRUPTED: &str = r#","typing_unit_ms":10,"user_input_timeline":[{"t_ms":25,"pid":4242,"kind":"key"}]"#;
const CLICK: &str = r#"{"jsonrpc":"2.0","id":3,"method":"click","params":{"target":"101","x":10,"y":10}}"#;
const TYPE: &str = r#"{"jsonrpc":"2.0","id":3,"method":"typeText","params":{"target":"101","text":"abcdefghij"}}"#;

#[test]
fn null_mode_refusals_keep_the_v1_bytes() {
    let locked = call(&mut opened(LOCKED, "{}"), CLICK);
    assert_eq!(
        locked["error"]["data"],
        json!({ "code": "ScreenLocked", "hint": null, "reason": "screen_locked" })
    );
    let interrupted = call(&mut opened(INTERRUPTED, "{}"), TYPE);
    let mut data = interrupted["error"]["data"].clone();
    assert!(data["callId"].is_string(), "{data}");
    data.as_object_mut().expect("data").remove("callId");
    assert_eq!(data, json!({ "code": "UserIntervened", "hint": null }));
}

#[test]
fn object_mode_refusals_carry_delivered_paused_and_session() {
    let object = r#"{"reportMode":"object"}"#;
    let locked = call(&mut opened(LOCKED, object), CLICK);
    let data = &locked["error"]["data"];
    assert_eq!(data["paused"], json!([{ "reason": "screen_locked", "ms": 120_001 }]));
    assert_eq!(data["session"]["screenLocked"], json!(true));
    assert!(data.get("delivered").is_none(), "nothing was sent: {data}");
    let interrupted = call(&mut opened(INTERRUPTED, object), TYPE);
    assert_eq!(interrupted["error"]["data"]["delivered"], json!({ "count": 3, "of": 10 }));
}

#[test]
fn a_reasoned_refusal_carries_its_reason() {
    let refusal = Refusal::new(EngineCode::InvalidTarget, "drag_destination");
    assert!(refusal.computer_code().is_ok(), "the pair has a table row");
    let Failure { code, data, .. } = refused(&refusal);
    assert_eq!(code, EngineCode::InvalidTarget.number());
    assert_eq!(data, Some(json!({ "code": "InvalidTarget", "hint": null, "reason": "drag_destination" })));
}
