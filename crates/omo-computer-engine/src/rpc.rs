//! JSON-RPC 2.0 framing: parses one request line, dispatches it to the session and answers
//! one reply line. A well-formed request without an id is a notification: it gets no reply
//! and never reaches the session, so it can send nothing. The one notification the protocol
//! defines, `$/cancel`, has nothing to cancel on this serial loop.

use omo_computer_core::backend::Refusal;
use omo_computer_core::methods::Method;
use omo_computer_session::grant::HostCallError;
use omo_computer_session::{Refused, Session, Unresolved};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};

pub const PARSE_ERROR: i64 = -32_700;
pub const INVALID_REQUEST: i64 = -32_600;
pub const METHOD_NOT_FOUND: i64 = -32_601;
pub const INVALID_PARAMS: i64 = -32_602;

struct Failure {
    code: i64,
    message: String,
    data: Option<Value>,
}

fn failure(code: i64, message: &str, data: Option<Value>) -> Failure {
    Failure {
        code,
        message: message.to_owned(),
        data,
    }
}

/// The reply line to `line` (raw bytes: a line that is not UTF-8 JSON is a parse error),
/// or `None` for a notification.
pub fn handle_line(session: &mut Session, line: &[u8]) -> Option<String> {
    let Ok(message) = serde_json::from_slice::<Value>(line) else {
        return Some(reply(&Value::Null, Err(failure(PARSE_ERROR, "Parse error", None))));
    };
    let Some(object) = message.as_object() else {
        return Some(reply(&Value::Null, Err(invalid_request())));
    };
    let id = object.get("id").cloned();
    let (method, params) = match request(object) {
        Ok(request) => request,
        Err(invalid) => return Some(reply(&id.unwrap_or(Value::Null), Err(invalid))),
    };
    let id = id?;
    Some(reply(&id, dispatch(session, method, params)))
}

fn invalid_request() -> Failure {
    failure(INVALID_REQUEST, "Invalid Request", None)
}

fn request(object: &Map<String, Value>) -> Result<(&str, Value), Failure> {
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err(invalid_request());
    }
    let method = object.get("method").and_then(Value::as_str).ok_or_else(invalid_request)?;
    let params = object.get("params").cloned().unwrap_or_else(|| json!({}));
    Ok((method, params))
}

fn parse<T: DeserializeOwned>(params: Value) -> Result<T, Failure> {
    serde_json::from_value(params).map_err(|error| {
        failure(INVALID_PARAMS, "Invalid params", Some(json!({ "detail": error.to_string() })))
    })
}

fn dispatch(session: &mut Session, name: &str, params: Value) -> Result<Value, Failure> {
    let not_found = || failure(METHOD_NOT_FOUND, "Method not found", Some(json!({ "method": name })));
    let method = Method::from_name(name).ok_or_else(not_found)?;
    let value = match method {
        Method::SessionOpen => json!(session.open(parse(params)?).map_err(|r| refused(&r))?),
        Method::StopPathStart => json!(session.stop_path_start(parse(params)?)),
        Method::StopPathStop => json!(session.stop_path_stop(parse(params)?)),
        Method::StopPathStatus => {
            parse::<omo_computer_core::params::EmptyParams>(params)?;
            json!(session.stop_path_status())
        }
        Method::StopPathHeartbeat => {
            parse::<omo_computer_core::params::EmptyParams>(params)?;
            session.stop_path_heartbeat();
            Value::Null
        }
        Method::SessionClose => {
            parse::<omo_computer_core::params::EmptyParams>(params)?;
            session.close();
            Value::Null
        }
        Method::Capabilities => {
            parse::<omo_computer_core::params::EmptyParams>(params)?;
            json!(session.capabilities())
        }
        Method::Displays => {
            parse::<omo_computer_core::params::EmptyParams>(params)?;
            json!(session.displays().map_err(|r| refused(&r))?)
        }
        Method::Capture => json!(session.capture(parse(params)?).map_err(|r| refused(&r))?),
        Method::Click => json!(session.click(parse(params)?).map_err(|r| refused_call(&r))?),
        Method::TypeText => json!(session.type_text(parse(params)?).map_err(|r| refused_call(&r))?),
        Method::Observe => json!(session.observe(parse(params)?).map_err(|u| unresolved(&u))?),
        Method::AxDrill => json!(session.drill(parse(params)?).map_err(|u| unresolved(&u))?),
        Method::AxNode => json!(session.ax_node(parse(params)?).map_err(|u| unresolved(&u))?),
        Method::AxChildren => json!(session.ax_children(parse(params)?).map_err(|u| unresolved(&u))?),
        _ => {
            return session.host_call(method, params).map_or_else(|| Err(not_found()), |r| r.map_err(host_failure))
        }
    };
    Ok(value)
}

// --- Rows 21-27: the session's host calls (R31); row 28 moves this into the engine router. ---

fn host_failure(error: HostCallError) -> Failure {
    match error {
        HostCallError::Params(error) => {
            failure(INVALID_PARAMS, "Invalid params", Some(json!({ "detail": error.to_string() })))
        }
        HostCallError::Refused(refused) => refused_call(&refused),
    }
}

/// A refusal on the wire: the closed engine code's number and name, `data.code` as v1 wrote
/// it, and `data.reason` when the refusal carries one. Every refusal resolves to its row of
/// the one error table (a bare refusal to its code's bare row); a pair with no row is a
/// backend defect, reported on stderr, and still answered with the refusal's own code.
fn refused(refusal: &Refusal) -> Failure {
    if let Err(unknown) = refusal.row() {
        eprintln!("omo-computer-engine: {unknown}");
    }
    failure(refusal.code.number(), refusal.code.wire(), Some(refusal.wire_data()))
}

/// A funnel refusal: the refusal's members plus the `callId` it concerns, for a replay the
/// stored `receipt` (`TransactionFailed{reason:"replayed", callId, receipt}`), and for a call
/// whose send was interrupted its `disposition` (`delivery_uncertain/unsafe`): without it
/// the code's own row would read `not_delivered/safe` and invite a resend.
fn refused_call(refused: &Refused) -> Failure {
    let mut failure = self::refused(&refused.refusal);
    if let Some(data) = failure.data.as_mut() {
        if let Some(call_id) = &refused.call_id {
            data["callId"] = json!(call_id);
        }
        if let Some(receipt) = &refused.receipt {
            data["receipt"] = (**receipt).clone();
        }
        if let Some(disposition) = refused.interrupted {
            data["disposition"] = json!(disposition);
        }
        let stamps = &refused.stamps;
        if let Some(delivered) = stamps.delivered {
            data["delivered"] = json!({ "count": delivered.count, "of": delivered.of });
        }
        if !stamps.paused.is_empty() {
            data["paused"] = json!(stamps.paused);
        }
        if let Some(session) = &stamps.session {
            data["session"] = json!(session);
        }
        if let Some(target) = stamps.target {
            data["target"] = json!(target);
        }
        if let (Some(Value::Object(detail)), Some(data)) = (refused.detail.as_deref(), data.as_object_mut()) {
            for (key, value) in detail {
                data.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
    }
    failure
}

/// A ref that did not resolve: the refusal, and on `AmbiguousTarget` the `candidates`.
fn unresolved(unresolved: &Unresolved) -> Failure {
    let mut failure = refused(&unresolved.refusal);
    if let Some(data) = failure.data.as_mut().filter(|_| !unresolved.candidates.is_empty()) {
        data["candidates"] = json!(unresolved.candidates);
    }
    failure
}

fn reply(id: &Value, outcome: Result<Value, Failure>) -> String {
    let message = match outcome {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(Failure { code, message, data }) => {
            let mut error = json!({ "code": code, "message": message });
            if let Some(data) = data {
                error["data"] = data;
            }
            json!({ "jsonrpc": "2.0", "id": id, "error": error })
        }
    };
    message.to_string()
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink};
    use omo_computer_core::backend::Backend;
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
            ..Refusal::new(EngineCode::TransactionFailed, "recovery_required").into()
        };
        let Failure { data, .. } = refused_call(&interrupted);
        let data = data.expect("data");
        assert_eq!(data["callId"], json!("k-1"));
        assert_eq!(data["disposition"], json!({ "delivery": "delivery_uncertain", "retry": "unsafe" }));
        let plain = refused_call(&Refusal::new(EngineCode::TransactionFailed, "marker_unavailable").into());
        assert!(plain.data.expect("data").get("disposition").is_none(), "a refusal before any send carries none");
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
}
