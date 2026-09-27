use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Desktop error vocabulary shared by the engine, the wire, and the host.
///
/// FROZEN: oh-my-pi's codes plus the stop-path, suspension, lock-screen,
/// cancellation, and restore-transaction codes. Adding a code needs a plan
/// amendment because the TS protocol and numeric JSON-RPC codes derive from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub enum ErrorCode {
    PermissionDenied,
    CaptureFailed,
    InputFailed,
    BackgroundUnavailable,
    WindowNotFound,
    InvalidTarget,
    InvalidKey,
    InvalidCoordinateFrame,
    StaleRef,
    AxUnsupported,
    AxFailed,
    Timeout,
    Closed,
    Internal,
    StopPathUnavailable,
    Suspended,
    ScreenLocked,
    /// A request aborted by `$/cancel` or a host abort.
    Cancelled,
    CursorRestoreFailed,
    FocusRestoreFailed,
    TransactionFailed,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PermissionDenied => "PermissionDenied",
            Self::CaptureFailed => "CaptureFailed",
            Self::InputFailed => "InputFailed",
            Self::BackgroundUnavailable => "BackgroundUnavailable",
            Self::WindowNotFound => "WindowNotFound",
            Self::InvalidTarget => "InvalidTarget",
            Self::InvalidKey => "InvalidKey",
            Self::InvalidCoordinateFrame => "InvalidCoordinateFrame",
            Self::StaleRef => "StaleRef",
            Self::AxUnsupported => "AxUnsupported",
            Self::AxFailed => "AxFailed",
            Self::Timeout => "Timeout",
            Self::Closed => "Closed",
            Self::Internal => "Internal",
            Self::StopPathUnavailable => "StopPathUnavailable",
            Self::Suspended => "Suspended",
            Self::ScreenLocked => "ScreenLocked",
            Self::Cancelled => "Cancelled",
            Self::CursorRestoreFailed => "CursorRestoreFailed",
            Self::FocusRestoreFailed => "FocusRestoreFailed",
            Self::TransactionFailed => "TransactionFailed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[error("{}: {}", .code.as_str(), .message)]
pub struct DesktopError {
    pub code: ErrorCode,
    pub message: String,
}

impl DesktopError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn permission_denied(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::PermissionDenied, message)
    }

    pub fn capture_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::CaptureFailed, message)
    }

    pub fn input_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InputFailed, message)
    }

    pub fn background_unavailable(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::BackgroundUnavailable, message)
    }

    pub fn window_not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::WindowNotFound, message)
    }

    pub fn invalid_target(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidTarget, message)
    }

    pub fn invalid_key(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidKey, message)
    }

    pub fn invalid_coordinate_frame(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidCoordinateFrame, message)
    }

    pub fn stale_ref(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::StaleRef, message)
    }

    pub fn ax_unsupported() -> Self {
        Self::new(
            ErrorCode::AxUnsupported,
            "accessibility is unavailable on this backend",
        )
    }

    pub fn ax_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::AxFailed, message)
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Timeout, message)
    }

    pub fn closed() -> Self {
        Self::new(ErrorCode::Closed, "desktop session is closed")
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }
}

pub type CoreResult<T> = Result<T, DesktopError>;
