//! The fail-closed input gate, ported from gajae-code
//! `pi-natives/src/computer/executor.rs` `gate()` plus the lock-screen probe.
//!
//! Every [`MutatingAction`] passes [`gate`] before a backend is touched. The
//! checks run in a fixed order and the first failure wins: suspension, a live
//! and fresh stop path under the policy, the lock screen, the input
//! permission, then (coordinate actions only) the expected frame and the
//! captured window's identity. The gate only reads the state it is handed;
//! it performs no I/O.

use std::fmt;

use senpi_desktop_core::error::{DesktopError, ErrorCode, TccPermission};
use senpi_desktop_core::frame::frame_reason;

use crate::{
    action::MutatingAction,
    supervisor::{ActiveStopPath, StopPathFailure, StopPolicy, Supervisor, SupervisorStatus},
};

/// Id of a captured frame, as named by a coordinate request's `frameId`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FrameId(String);

impl FrameId {
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Result of the backend's lock-screen probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockState {
    Unlocked,
    Locked,
    /// The probe failed or the platform cannot tell.
    Unknown,
}

impl LockState {
    /// Only a positive probe counts as locked; `Unknown` is reported and gated
    /// as unlocked (`screenLocked: false`).
    #[must_use]
    pub const fn is_locked(self) -> bool {
        match self {
            Self::Locked => true,
            Self::Unlocked | Self::Unknown => false,
        }
    }
}

/// The platform's input grant (macOS Accessibility, ...).
pub trait PermissionGate {
    fn input_granted(&self) -> bool;
}

/// Why a coordinate request's frame cannot take input, checked in this
/// order before today's latest-capture check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameRefusal {
    /// No `frameId` was named and the target has no capture to default to.
    FrameRequired,
    /// The named frame is another target's capture.
    WrongTarget,
    /// The named frame exists, but this target has no capture at all.
    NoCapture,
    /// The named frame is an earlier capture of this target, or comes from
    /// an earlier engine instance.
    Superseded,
    /// The frame was used by an action sent with `consume: true`.
    Consumed,
}

impl FrameRefusal {
    /// The wire token of `data.reason`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FrameRequired => "frame_required",
            Self::WrongTarget => "wrong_target",
            Self::NoCapture => "no_capture",
            Self::Superseded => "superseded",
            Self::Consumed => "consumed",
        }
    }

    const fn message(self) -> &'static str {
        match self {
            Self::FrameRequired => {
                "this target has no capture yet; capture it first, coordinates are pixels of that capture"
            }
            Self::WrongTarget => {
                "the frame is another target's capture; capture this target and use its frame"
            }
            Self::NoCapture => "this target has no capture yet; capture it before coordinate input",
            Self::Superseded => {
                "the frame is not the target's latest capture; capture it again before coordinate input"
            }
            Self::Consumed => {
                "the frame was consumed by an earlier action; capture the target again before coordinate input"
            }
        }
    }
}

/// The target's frame and session state the gate checks against.
pub trait FrameContext {
    fn screen_locked(&self) -> LockState;
    /// Whether `frame` is the target's latest capture.
    fn is_latest(&self, frame: &FrameId) -> bool;
    /// Why the request's frame (`frame`, or the target's latest when `None`)
    /// cannot take input; `None` when it can, or when the session answers
    /// with today's single latest-capture check.
    fn frame_refusal(&self, _frame: Option<&FrameId>) -> Option<FrameRefusal> {
        None
    }
    /// Whether the captured window now belongs to another process (object
    /// mode, window frames that recorded an identity).
    fn identity_changed(&self) -> bool {
        false
    }
}

/// Why no stop path may authorize input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopPathReason {
    AccessibilityDenied,
    /// No stop path is live.
    NoGlobalListener,
    /// A usable stop path is live but its heartbeat is older than
    /// [`crate::HEARTBEAT_FRESH_MS`].
    HeartbeatStale,
    /// Only the host relay is live and `computer.allowHostRelayOnlyStop` is off.
    HostRelayNotAllowed,
    /// The macOS SkyLight receipt canary failed (reported by the backend).
    SkylightCanaryFailed,
    /// macOS Secure Event Input is on (a focused password field, Secure
    /// Keyboard Entry), so the stop chord cannot be heard until it ends.
    SecureInputActive,
}

impl StopPathReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AccessibilityDenied => "accessibility-denied",
            Self::NoGlobalListener => "no-global-listener",
            Self::HeartbeatStale => "heartbeat-stale",
            Self::HostRelayNotAllowed => "host-relay-not-allowed",
            Self::SkylightCanaryFailed => "skylight-canary-failed",
            Self::SecureInputActive => "secure-input-active",
        }
    }
}

impl SupervisorStatus {
    /// Why no stop path authorizes input under `policy`, ignoring suspension;
    /// `None` when one does.
    #[must_use]
    pub const fn stop_path_unavailable(self, policy: &StopPolicy) -> Option<StopPathReason> {
        match (self.stop_path, self.heartbeat_fresh) {
            (ActiveStopPath::None, _) => Some(match self.global_failure {
                Some(StopPathFailure::AccessibilityDenied) => StopPathReason::AccessibilityDenied,
                Some(StopPathFailure::SecureInput) => StopPathReason::SecureInputActive,
                _ => StopPathReason::NoGlobalListener,
            }),
            (ActiveStopPath::HostRelay, _) if !policy.allow_host_relay_only => {
                Some(match self.global_failure {
                    Some(StopPathFailure::AccessibilityDenied) => StopPathReason::AccessibilityDenied,
                    Some(StopPathFailure::SecureInput) => StopPathReason::SecureInputActive,
                    _ => StopPathReason::HostRelayNotAllowed,
                })
            }
            (ActiveStopPath::Global | ActiveStopPath::HostRelay, false) => {
                Some(StopPathReason::HeartbeatStale)
            }
            (ActiveStopPath::Global | ActiveStopPath::HostRelay, true) => None,
        }
    }
}

impl fmt::Display for StopPathReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The first gate check that refused an action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum GateError {
    #[error("input is suspended until the user resumes it")]
    Suspended,
    #[error("{reason}")]
    StopPathUnavailable { reason: StopPathReason },
    #[error("the interactive session is behind the lock screen")]
    ScreenLocked,
    #[error("input permission is not granted")]
    PermissionDenied { permission: TccPermission },
    #[error("the frame is not the target's latest capture; capture it again before coordinate input")]
    InvalidCoordinateFrame,
    #[error("{}", .reason.message())]
    FrameRefused { reason: FrameRefusal },
    #[error("the captured window now belongs to another process; find the window again before coordinate input")]
    IdentityChanged,
}

impl GateError {
    #[must_use]
    pub const fn code(self) -> ErrorCode {
        match self {
            Self::Suspended => ErrorCode::Suspended,
            Self::StopPathUnavailable { .. } => ErrorCode::StopPathUnavailable,
            Self::ScreenLocked => ErrorCode::ScreenLocked,
            Self::PermissionDenied { .. } => ErrorCode::PermissionDenied,
            Self::InvalidCoordinateFrame | Self::FrameRefused { .. } => ErrorCode::InvalidCoordinateFrame,
            Self::IdentityChanged => ErrorCode::WindowNotFound,
        }
    }

    /// The object-mode `data.reason` token, when the refusal has one.
    #[must_use]
    pub const fn reason(self) -> Option<&'static str> {
        match self {
            Self::FrameRefused { reason } => Some(reason.as_str()),
            Self::IdentityChanged => Some("identity_changed"),
            _ => None,
        }
    }
}

impl From<GateError> for DesktopError {
    fn from(error: GateError) -> Self {
        let refused = Self::new(error.code(), error.to_string());
        match error.reason() {
            Some(reason) => frame_reason(refused, reason),
            None => refused,
        }
    }
}

/// Fail-closed gate run before any side-effecting input.
///
/// # Errors
/// The first failing check, in the order the module docs give.
pub fn gate(
    action: &MutatingAction,
    supervisor: &Supervisor,
    policy: &StopPolicy,
    perms: &dyn PermissionGate,
    frames: &dyn FrameContext,
    expected_frame: Option<FrameId>,
) -> Result<(), GateError> {
    let status = supervisor.status();
    if status.suspended {
        return Err(GateError::Suspended);
    }
    if let Some(reason) = status.stop_path_unavailable(policy) {
        if reason == StopPathReason::AccessibilityDenied {
            return Err(GateError::PermissionDenied { permission: TccPermission::Accessibility });
        }
        return Err(GateError::StopPathUnavailable { reason });
    }
    if frames.screen_locked().is_locked() {
        return Err(GateError::ScreenLocked);
    }
    if !perms.input_granted() {
        return Err(GateError::PermissionDenied { permission: TccPermission::Accessibility });
    }
    if !action.is_coordinate() {
        return Ok(());
    }
    if let Some(reason) = frames.frame_refusal(expected_frame.as_ref()) {
        return Err(GateError::FrameRefused { reason });
    }
    if expected_frame.is_some_and(|expected| !frames.is_latest(&expected)) {
        return Err(GateError::InvalidCoordinateFrame);
    }
    if frames.identity_changed() {
        return Err(GateError::IdentityChanged);
    }
    Ok(())
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod permission_tests;
