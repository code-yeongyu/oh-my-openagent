//! JSON-RPC reply lines: the engine's failure kinds and their wire error
//! objects `{code, message, data}`.

use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol::{
    rpc_error_code, EngineErrorData, JsonRpcVersion, MethodRejection, MethodRejectionData, RequestId,
    RpcError, RpcErrorData, RpcFailure, RpcSuccess, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND,
    PARSE_ERROR,
};
use serde::Serialize;
use serde_json::Value;

/// Why a request did not produce a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// A desktop error: `-32000 - ordinal` with `data: {code, hint}`.
    Engine(DesktopError),
    /// `-32601` with `data: {reason}`.
    Rejected(MethodRejection),
    InvalidParams(String),
    InvalidRequest(String),
    Parse(String),
}

impl Failure {
    pub fn cancelled() -> Self {
        Self::Engine(DesktopError::new(
            ErrorCode::Cancelled,
            "request was cancelled by $/cancel",
        ))
    }

    /// A method of the frozen table whose engine side lands in a later todo.
    pub fn not_implemented(method: Method) -> Self {
        Self::Engine(DesktopError::internal(format!(
            "{} is not implemented by this engine build yet",
            method.spec().name
        )))
    }

    fn into_rpc_error(self) -> RpcError {
        match self {
            Self::Engine(error) => RpcError {
                code: rpc_error_code(error.code),
                message: error.message,
                data: Some(RpcErrorData::Engine(EngineErrorData {
                    code: error.code,
                    hint: None,
                })),
            },
            Self::Rejected(reason) => RpcError {
                code: METHOD_NOT_FOUND,
                message: "Method not found".to_owned(),
                data: Some(RpcErrorData::Rejected(MethodRejectionData { reason })),
            },
            Self::InvalidParams(message) => bare(INVALID_PARAMS, message),
            Self::InvalidRequest(message) => bare(INVALID_REQUEST, message),
            Self::Parse(message) => bare(PARSE_ERROR, message),
        }
    }
}

const fn bare(code: i64, message: String) -> RpcError {
    RpcError {
        code,
        message,
        data: None,
    }
}

/// Serializes a method result for the wire.
pub fn to_result(value: impl Serialize) -> Result<Value, Failure> {
    serde_json::to_value(value)
        .map_err(|error| Failure::Engine(DesktopError::internal(format!("cannot encode result: {error}"))))
}

/// The reply line for request `id`.
pub fn reply_line(id: RequestId, outcome: Result<Value, Failure>) -> String {
    match outcome {
        Ok(result) => line(&RpcSuccess {
            jsonrpc: JsonRpcVersion::V2,
            id,
            result,
        }),
        Err(failure) => failure_line(Some(id), failure),
    }
}

/// An error reply; `id` is `None` only when the request's id is unreadable.
pub fn failure_line(id: Option<RequestId>, failure: Failure) -> String {
    line(&RpcFailure {
        jsonrpc: JsonRpcVersion::V2,
        id,
        error: failure.into_rpc_error(),
    })
}

fn line(message: &impl Serialize) -> String {
    serde_json::to_string(message).unwrap_or_else(|error| {
        let internal = rpc_error_code(ErrorCode::Internal);
        let message = serde_json::to_string(&format!("cannot encode reply: {error}"))
            .unwrap_or_else(|_| "\"cannot encode reply\"".to_owned());
        format!(r#"{{"jsonrpc":"2.0","id":null,"error":{{"code":{internal},"message":{message}}}}}"#)
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn parsed(line: &str) -> Value {
        serde_json::from_str(line).unwrap()
    }

    #[test]
    fn desktop_errors_carry_their_numeric_code_and_error_code_name() {
        let line = reply_line(RequestId::Number(7), Err(Failure::Engine(DesktopError::closed())));
        assert_eq!(
            parsed(&line)["error"],
            json!({"code": -32012, "message": "desktop session is closed", "data": {"code": "Closed", "hint": null}})
        );
    }

    #[test]
    fn method_rejections_are_method_not_found_with_a_reason() {
        let line = failure_line(
            Some(RequestId::String("a".into())),
            Failure::Rejected(MethodRejection::TestOnly),
        );
        assert_eq!(parsed(&line)["id"], json!("a"));
        assert_eq!(parsed(&line)["error"]["code"], json!(-32601));
        assert_eq!(parsed(&line)["error"]["data"], json!({"reason": "testOnly"}));
    }

    #[test]
    fn parse_errors_answer_a_null_id() {
        let line = failure_line(None, Failure::Parse("bad".into()));
        assert_eq!(parsed(&line)["id"], Value::Null);
        assert_eq!(parsed(&line)["error"]["code"], json!(-32700));
    }
}
