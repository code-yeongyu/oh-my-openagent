//! JSON-RPC reply lines: the engine's failure kinds and their wire error
//! objects `{code, message, data}`.

use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::report::Disposition;
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

    /// An object-mode reply to a mutating request the worker never reported:
    /// - a `Cancelled` or `Timeout` the waiter wrote may have raced a running
    ///   request that sent input: `delivery_uncertain/unsafe`, no `delivered`;
    /// - `Closed` is the session refusing a request sent after
    ///   `session.close`: it never reached the session thread, `not_delivered/safe`;
    /// - anything else is a session thread that stopped or ended without
    ///   replying: nothing says how far the request got, `unknown`.
    ///
    /// An error that already carries the worker's report is left alone.
    #[must_use]
    pub fn with_unreported_disposition(self) -> Self {
        match self {
            Self::Engine(error) => {
                let disposition = match error.code {
                    ErrorCode::Cancelled | ErrorCode::Timeout => Disposition::UNCERTAIN_UNSAFE,
                    ErrorCode::Closed => Disposition::NOT_DELIVERED_SAFE,
                    _ => Disposition::UNKNOWN,
                };
                Self::Engine(error.with_fallback_disposition(disposition))
            }
            other => other,
        }
    }

    fn into_rpc_error(self) -> RpcError {
        match self {
            Self::Engine(error) => {
                let report = error.report.map(|report| *report).unwrap_or_default();
                RpcError {
                    code: rpc_error_code(error.code),
                    message: error.message,
                    data: Some(RpcErrorData::Engine(EngineErrorData {
                        code: error.code,
                        hint: None,
                        permission: error.permission,
                        capture_unavailable: error.capture_unavailable.map(|data| *data),
                        reason: report.reason,
                        disposition: report.disposition,
                        delivered: report.delivered,
                        focus_restoration: report.focus_restoration,
                        next_call: report.next_call.map(Box::new),
                    })),
                }
            }
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
    fn permission_denial_preserves_all_guidance_fields_on_the_wire() {
        use senpi_desktop_core::error::{PermissionDeniedData, TccPermission};
        let data = PermissionDeniedData {
            permission: TccPermission::Accessibility,
            settings_url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility".into(),
            app: "QA App".into(),
            relaunch_required: true,
        };
        let error = DesktopError::permission_denied_with(data, "marked backend refusal");
        let line = reply_line(RequestId::Number(9), Err(Failure::Engine(error)));
        assert_eq!(parsed(&line)["error"], json!({
            "code": -32000,
            "message": "marked backend refusal",
            "data": {
                "code": "PermissionDenied", "hint": null,
                "permission": { "permission": "accessibility",
                    "settingsUrl": "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
                    "app": "QA App", "relaunchRequired": true }
            }
        }));
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
    fn a_lost_session_thread_answers_an_unknown_disposition() {
        use senpi_desktop_session::THREAD_NAME;
        // Given the two replies a lost session thread produces (`enqueue`, `Pending::wait`).
        for message in [
            format!("{THREAD_NAME} stopped unexpectedly"),
            format!("{THREAD_NAME} ended without replying"),
        ] {
            // When an object-mode mutating request is answered with it.
            let failure = Failure::Engine(DesktopError::internal(message.clone()))
                .with_unreported_disposition();
            let line = reply_line(RequestId::Number(5), Err(failure));
            // Then nothing says how far the request got.
            assert_eq!(
                parsed(&line)["error"]["data"]["disposition"],
                json!({"delivery": "unknown", "retry": "unknown"}),
                "{message}"
            );
        }
    }

    #[test]
    fn a_worker_report_is_never_replaced_by_the_fallback_disposition() {
        use senpi_desktop_core::error::ErrorReport;
        // Given an error the worker already reported.
        let reported =
            DesktopError::internal("the desktop backend panicked").with_report(ErrorReport {
                disposition: Some(Disposition::UNCERTAIN_UNKNOWN),
                ..ErrorReport::default()
            });
        // When the waiter maps it.
        let Failure::Engine(error) = Failure::Engine(reported).with_unreported_disposition() else {
            panic!("an engine failure stays an engine failure");
        };
        // Then the worker's disposition stands.
        assert_eq!(
            error.report.and_then(|report| report.disposition),
            Some(Disposition::UNCERTAIN_UNKNOWN)
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
