//! JSON-RPC 2.0 framing: parses one request line, dispatches it to the session and answers
//! one reply line. A well-formed request without an id is a notification: it gets no reply
//! and never reaches the session, so it can send nothing. The one notification the protocol
//! defines, `$/cancel`, has nothing to cancel on this serial loop.

use omo_computer_core::methods::Method;
use omo_computer_session::Session;
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};

mod refusals;
use refusals::{host_failure, refused, refused_call, unresolved};

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
mod tests;
