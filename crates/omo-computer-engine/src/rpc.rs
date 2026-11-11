//! JSON-RPC 2.0 framing: parses one request line, dispatches it to the session and answers
//! one reply line. A request without an id is a notification and gets no reply.

use omo_computer_core::error::EngineCode;
use omo_computer_core::methods::Method;
use omo_computer_session::{Session, SessionError};
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

/// The reply line to `line`, or `None` for a notification.
pub fn handle_line(session: &mut Session, line: &str) -> Option<String> {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return Some(reply(&Value::Null, Err(failure(PARSE_ERROR, "Parse error", None))));
    };
    let Some(object) = message.as_object() else {
        return Some(reply(&Value::Null, Err(invalid_request())));
    };
    let id = object.get("id").cloned();
    let outcome = request(object).and_then(|(method, params)| dispatch(session, method, params));
    id.map(|id| reply(&id, outcome))
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
        Method::SessionOpen => json!(session.open(parse(params)?)),
        Method::SessionClose => {
            parse::<omo_computer_core::params::EmptyParams>(params)?;
            session.close();
            Value::Null
        }
        Method::Capabilities => {
            parse::<omo_computer_core::params::EmptyParams>(params)?;
            json!(session.capabilities())
        }
        Method::Click => json!(session.click(parse(params)?).map_err(session_failure)?),
        Method::TypeText => json!(session.type_text(parse(params)?).map_err(session_failure)?),
        _ => return Err(not_found()),
    };
    Ok(value)
}

fn engine_failure(code: EngineCode, data: Value) -> Failure {
    failure(code.number(), code.wire(), Some(data))
}

fn session_failure(error: SessionError) -> Failure {
    match error {
        SessionError::NotOpen => engine_failure(
            EngineCode::Closed,
            json!({ "reason": "session_not_open", "nothingSent": true }),
        ),
        SessionError::PointRequired => engine_failure(
            EngineCode::InvalidTarget,
            json!({ "reason": "point_required", "nothingSent": true }),
        ),
        SessionError::Refused(refusal) => {
            let spelling = refusal.code.engine_code();
            engine_failure(
                EngineCode::from_wire(spelling).unwrap_or(EngineCode::Internal),
                json!({ "reason": refusal.reason, "nothingSent": refusal.nothing_sent(), "refusal": spelling }),
            )
        }
    }
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
    use omo_computer_backend_fake::FakeBackend;
    use omo_computer_core::backend::Backend;
    use serde_json::{json, Value};

    use super::*;

    fn session() -> Session {
        let backend: Box<dyn Backend> = Box::new(FakeBackend::from_json("{}").expect("empty scenario"));
        Session::new(backend)
    }

    fn call(session: &mut Session, line: &str) -> Value {
        serde_json::from_str(&handle_line(session, line).expect("a reply")).expect("reply is JSON")
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
        assert_eq!(handle_line(&mut session, r#"{"jsonrpc":"2.0","method":"capabilities"}"#), None);
    }

    #[test]
    fn exec_without_a_session_is_refused_with_nothing_sent() {
        let mut session = session();
        let reply = call(&mut session, r#"{"jsonrpc":"2.0","id":1,"method":"typeText","params":{"target":"1","text":"x"}}"#);
        assert_eq!(reply["error"]["code"], json!(EngineCode::Closed.number()));
        assert_eq!(reply["error"]["data"]["nothingSent"], json!(true));
    }
}
