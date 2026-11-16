//! The wire's error object and the reply line every transport writes: one JSON-RPC 2.0 object
//! per message. A refusal of the session reaches the wire through `refusals`; the router's
//! own answers (framing, the exposure bridge) are built here.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;
use serde_json::{json, Value};

pub const PARSE_ERROR: i64 = -32_700;
pub const INVALID_REQUEST: i64 = -32_600;
pub const METHOD_NOT_FOUND: i64 = -32_601;
pub const INVALID_PARAMS: i64 = -32_602;

#[derive(Debug, Clone, PartialEq)]
pub struct WireError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl WireError {
    #[must_use]
    pub fn new(code: i64, message: &str, data: Option<Value>) -> Self {
        Self {
            code,
            message: message.to_owned(),
            data,
        }
    }

    /// The v1 rejection of a method a caller may not reach: `unknown`, `hostOnly` or `testOnly`.
    #[must_use]
    pub fn rejected(reason: &str) -> Self {
        Self::new(METHOD_NOT_FOUND, "Method not found", Some(json!({ "reason": reason })))
    }

    #[must_use]
    pub fn invalid_params(error: &serde_json::Error) -> Self {
        Self::new(INVALID_PARAMS, "Invalid params", Some(json!({ "detail": error.to_string() })))
    }

    /// The bare row of `code` as the session writes it (`data:{code, hint}`).
    #[must_use]
    pub fn bare(code: EngineCode) -> Self {
        super::refusals::refused(&Refusal::bare(code))
    }

    #[must_use]
    pub fn to_value(&self) -> Value {
        let mut error = json!({ "code": self.code, "message": self.message });
        if let Some(data) = &self.data {
            error["data"] = data.clone();
        }
        error
    }
}

/// The reply line to request `id`.
#[must_use]
pub fn reply(id: &Value, outcome: &Result<Value, WireError>) -> Value {
    match outcome {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error.to_value() }),
    }
}

#[must_use]
pub fn notification(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rejection_carries_only_its_reason() {
        let reply = reply(&json!(3), &Err(WireError::rejected("hostOnly")));
        assert_eq!(
            reply,
            json!({"jsonrpc": "2.0", "id": 3, "error": {"code": -32601, "message": "Method not found", "data": {"reason": "hostOnly"}}})
        );
    }

    #[test]
    fn a_bare_row_names_its_code() {
        let cancelled = WireError::bare(EngineCode::Cancelled);
        assert_eq!(cancelled.code, EngineCode::Cancelled.number());
        assert_eq!(cancelled.data, Some(json!({"code": "Cancelled", "hint": null})));
    }
}
