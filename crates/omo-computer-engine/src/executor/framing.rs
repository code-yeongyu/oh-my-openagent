//! JSON-RPC 2.0 framing of one input line (raw bytes: a line that is not UTF-8 JSON is a parse
//! error). A well-formed message without an id is a notification: it never reaches the session.

use serde_json::{json, Value};

use crate::router::{WireError, INVALID_REQUEST, PARSE_ERROR};

pub enum Line {
    Blank,
    Invalid(Value, WireError),
    Notification { method: String, params: Value },
    Request { id: Value, method: String, params: Value },
}

pub fn parse(line: &[u8]) -> Line {
    if line.trim_ascii().is_empty() {
        return Line::Blank;
    }
    let invalid = || WireError::new(INVALID_REQUEST, "Invalid Request", None);
    let Ok(message) = serde_json::from_slice::<Value>(line) else {
        return Line::Invalid(Value::Null, WireError::new(PARSE_ERROR, "Parse error", None));
    };
    let Some(object) = message.as_object() else {
        return Line::Invalid(Value::Null, invalid());
    };
    let id = object.get("id").cloned();
    let method = object.get("method").and_then(Value::as_str);
    let (Some("2.0"), Some(method)) = (object.get("jsonrpc").and_then(Value::as_str), method) else {
        return Line::Invalid(id.unwrap_or(Value::Null), invalid());
    };
    let params = object.get("params").cloned().unwrap_or_else(|| json!({}));
    match id {
        None => Line::Notification {
            method: method.to_owned(),
            params,
        },
        Some(id) => Line::Request {
            id,
            method: method.to_owned(),
            params,
        },
    }
}
