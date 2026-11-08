use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::report::{Delivered, Disposition, FocusRestoration};

/// Desktop error vocabulary shared by the engine, the wire, and the host.
///
/// FROZEN: oh-my-pi's codes plus the stop-path, suspension, lock-screen,
/// cancellation, and restore-transaction codes. Adding a code needs a plan
/// amendment because the TS protocol and numeric JSON-RPC codes derive from it.
/// The enum is append-only: a new code takes the next ordinal, so no existing
/// numeric code moves. Amendment 1 (macOS shared-screen parity, #11459 /
/// #11461) appended `UserIntervened`, `AxUnconfirmed`, `SpaceUnsupported` and
/// `SpaceMoveDenied` (-32024..-32027) without a protocol version change.
/// Amendment 2 (computer-use v2 P1a) appended `AmbiguousTarget`,
/// `CaptureConsentRequired` and `ProtectedProcess` (-32028..-32030), also
/// without a protocol version change.
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
    /// Another session holds the foreground control grant. The slot is never
    /// stolen; the caller can retry after it releases.
    InputBusy,
    /// Foreground delivery without this session's live control grant.
    ControlRequired,
    /// The capture target exists but cannot be captured right now; `data`
    /// says why (e.g. `{ "reason": "minimized" }`).
    CaptureUnavailable,
    /// The user was using the target app, or brought another window to the
    /// front, before or during the action, so the action stopped; the message
    /// says whether any input was sent. Read the window again once the user
    /// pauses; never repeat the action blindly.
    UserIntervened,
    /// An accessibility request was made, but the app did not confirm its
    /// outcome (it did not reply in time or messaging failed, e.g. while the
    /// action opened a modal dialog). It may already have taken effect: read
    /// the element back before any retry.
    AxUnconfirmed,
    /// Moving a window between Spaces is not available on this backend or OS
    /// version.
    SpaceUnsupported,
    /// The window server refused the Space move, or the move could not be
    /// verified.
    SpaceMoveDenied,
    /// A target description matched more than one window or element; the
    /// caller must name one of the candidates.
    AmbiguousTarget,
    /// Capturing this target needs the user's consent first.
    CaptureConsentRequired,
    /// The target process is protected: the engine never sends it input.
    ProtectedProcess,
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
            Self::InputBusy => "InputBusy",
            Self::ControlRequired => "ControlRequired",
            Self::CaptureUnavailable => "CaptureUnavailable",
            Self::UserIntervened => "UserIntervened",
            Self::AxUnconfirmed => "AxUnconfirmed",
            Self::SpaceUnsupported => "SpaceUnsupported",
            Self::SpaceMoveDenied => "SpaceMoveDenied",
            Self::AmbiguousTarget => "AmbiguousTarget",
            Self::CaptureConsentRequired => "CaptureConsentRequired",
            Self::ProtectedProcess => "ProtectedProcess",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TccPermission {
    ScreenRecording,
    Accessibility,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDeniedData {
    pub permission: TccPermission,
    pub settings_url: String,
    pub app: String,
    pub relaunch_required: bool,
}

/// Why a `CaptureUnavailable` capture was refused. `reason` is an open token
/// set: B9 introduces `"minimized"`; P8 adds `"off-space"` and `"off-screen"`; later waves add more.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptureUnavailableData {
    pub reason: String,
}

/// What an error adds in a session opened with `reportMode: "object"`:
/// why it happened and whether input reached the target. Never set in a
/// `reportMode: "null"` session.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ErrorReport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disposition: Option<Disposition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered: Option<Delivered>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus_restoration: Option<FocusRestoration>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[error("{}: {}", .code.as_str(), .message)]
pub struct DesktopError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<PermissionDeniedData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture_unavailable: Option<Box<CaptureUnavailableData>>,
    /// Object-mode additions, mirrored on the wire's `EngineErrorData`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report: Option<Box<ErrorReport>>,
}

impl DesktopError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            permission: None,
            capture_unavailable: None,
            report: None,
        }
    }

    /// Attaches the object-mode report.
    #[must_use]
    pub fn with_report(mut self, report: ErrorReport) -> Self {
        self.report = Some(Box::new(report));
        self
    }

    /// Attaches an object-mode report carrying only `disposition`, unless the
    /// error already carries the worker's report.
    #[must_use]
    pub fn with_fallback_disposition(self, disposition: Disposition) -> Self {
        if self.report.is_some() {
            return self;
        }
        self.with_report(ErrorReport {
            disposition: Some(disposition),
            ..ErrorReport::default()
        })
    }

    pub fn permission_denied(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::PermissionDenied, message)
    }

    pub fn permission_denied_with(data: PermissionDeniedData, message: impl Into<String>) -> Self {
        Self {
            permission: Some(data),
            ..Self::permission_denied(message)
        }
    }

    pub fn capture_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::CaptureFailed, message)
    }

    /// A capture refused because of the target's state; `reason` is the
    /// machine-readable cause (B9: `"minimized"`).
    pub fn capture_unavailable(reason: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(ErrorCode::CaptureUnavailable, message)
            .with_capture_unavailable_reason(reason)
    }

    /// Attaches `CaptureUnavailable` data; only meaningful on that code.
    #[must_use]
    pub fn with_capture_unavailable_reason(mut self, reason: impl Into<String>) -> Self {
        self.capture_unavailable = Some(Box::new(CaptureUnavailableData {
            reason: reason.into(),
        }));
        self
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
        Self::new(ErrorCode::AxUnsupported, "accessibility is unavailable on this backend")
    }

    pub fn ax_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::AxFailed, message)
    }

    pub fn ax_unconfirmed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::AxUnconfirmed, message)
    }

    pub fn user_intervened(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::UserIntervened, message)
    }

    pub fn space_unsupported(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::SpaceUnsupported, message)
    }

    pub fn space_move_denied(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::SpaceMoveDenied, message)
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Timeout, message)
    }

    pub fn input_busy(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InputBusy, message)
    }

    pub fn control_required(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ControlRequired, message)
    }

    pub fn closed() -> Self {
        Self::new(ErrorCode::Closed, "desktop session is closed")
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }
}

pub type CoreResult<T> = Result<T, DesktopError>;
