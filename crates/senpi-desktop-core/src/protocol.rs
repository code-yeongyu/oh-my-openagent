//! The engine wire protocol: JSON-RPC 2.0 over NDJSON. Versions, envelopes,
//! and the numeric error-code mapping. The method table is `methods.rs`; the
//! generated schema is `crate::engine_schema()`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::ErrorCode;
use crate::methods::Notification;

/// Engine protocol version reported by `engine.hello`.
pub const PROTOCOL_VERSION: &str = "1";
/// ABI marker a host checks in the `engine.hello` reply.
pub const ABI: &str = "senpi-desktop/1";

/// Standard JSON-RPC 2.0 error codes the engine emits.
pub const PARSE_ERROR: i64 = -32_700;
pub const INVALID_REQUEST: i64 = -32_600;
/// Every method-level rejection, with `data.reason` saying why.
pub const METHOD_NOT_FOUND: i64 = -32_601;
pub const INVALID_PARAMS: i64 = -32_602;

/// First code of the `ErrorCode` range: `ErrorCode` ordinal `n` is
/// `ENGINE_ERROR_BASE - n`.
pub const ENGINE_ERROR_BASE: i64 = -32_000;

/// Every `ErrorCode`, in declaration (ordinal) order.
pub const ERROR_CODES: [ErrorCode; 21] = [
    ErrorCode::PermissionDenied,
    ErrorCode::CaptureFailed,
    ErrorCode::InputFailed,
    ErrorCode::BackgroundUnavailable,
    ErrorCode::WindowNotFound,
    ErrorCode::InvalidTarget,
    ErrorCode::InvalidKey,
    ErrorCode::InvalidCoordinateFrame,
    ErrorCode::StaleRef,
    ErrorCode::AxUnsupported,
    ErrorCode::AxFailed,
    ErrorCode::Timeout,
    ErrorCode::Closed,
    ErrorCode::Internal,
    ErrorCode::StopPathUnavailable,
    ErrorCode::Suspended,
    ErrorCode::ScreenLocked,
    ErrorCode::Cancelled,
    ErrorCode::CursorRestoreFailed,
    ErrorCode::FocusRestoreFailed,
    ErrorCode::TransactionFailed,
];

/// The numeric JSON-RPC error code for `code`: `-32000 - ordinal`.
#[must_use]
pub const fn rpc_error_code(code: ErrorCode) -> i64 {
    // A fieldless enum's discriminant is its declaration ordinal.
    ENGINE_ERROR_BASE - code as i64
}

/// Why a request was answered `-32601`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MethodRejection {
    /// Not in the method table.
    Unknown,
    /// A bridge (`--oneshot`) refused a host-only method.
    HostOnly,
    /// A test-only method without `SENPI_DESKTOP_FAKE_CLOCK=1`.
    TestOnly,
}

/// A JSON-RPC request id: a number or a string, echoed verbatim.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum RequestId {
    Number(i64),
    String(String),
}

/// The `jsonrpc` member, always `"2.0"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub enum JsonRpcVersion {
    #[default]
    #[serde(rename = "2.0")]
    V2,
}

/// A client request, or a client notification when `id` is absent
/// (`$/cancel`). `method` stays a string so unknown names parse and get
/// rejected with `-32601`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct RpcRequest {
    pub jsonrpc: JsonRpcVersion,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<RequestId>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// A reply to one request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum RpcResponse {
    Success(RpcSuccess),
    Failure(RpcFailure),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct RpcSuccess {
    pub jsonrpc: JsonRpcVersion,
    pub id: RequestId,
    pub result: Value,
}

/// `id` is `null` only when the request id could not be read (parse error).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct RpcFailure {
    pub jsonrpc: JsonRpcVersion,
    pub id: Option<RequestId>,
    pub error: RpcError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<RpcErrorData>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum RpcErrorData {
    /// Carried by every `ErrorCode` error (`code == rpc_error_code(data.code)`).
    Engine(EngineErrorData),
    /// Carried by every `-32601` rejection.
    Rejected(MethodRejectionData),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct EngineErrorData {
    pub code: ErrorCode,
    /// Recovery hint for the model, e.g. `capture it again`.
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct MethodRejectionData {
    pub reason: MethodRejection,
}

/// A server-to-client notification.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct RpcNotification {
    pub jsonrpc: JsonRpcVersion,
    pub method: Notification,
    pub params: Value,
}

#[cfg(test)]
#[path = "protocol_test.rs"]
mod tests;

#[cfg(test)]
#[path = "protocol_validator.rs"]
mod validator;

#[cfg(test)]
#[path = "protocol_conformance_test.rs"]
mod conformance_tests;
