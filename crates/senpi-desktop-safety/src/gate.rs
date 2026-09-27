//! The fail-closed input gate, ported from gajae-code
//! `pi-natives/src/computer/executor.rs` `gate()` plus the lock-screen probe.
//!
//! Every [`MutatingAction`] passes [`gate`] before a backend is touched. The
//! checks run in a fixed order and the first failure wins: suspension, a live
//! and fresh stop path under the policy, the lock screen, the input
//! permission, then (coordinate actions only) the expected frame. The gate
//! only reads the state it is handed; it performs no I/O.

use std::fmt;

use senpi_desktop_core::error::{DesktopError, ErrorCode};

use crate::{
    action::MutatingAction,
    supervisor::{ActiveStopPath, StopPolicy, Supervisor, SupervisorStatus},
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

/// The target's frame and session state the gate checks against.
pub trait FrameContext {
    fn screen_locked(&self) -> LockState;
    /// Whether `frame` is the target's latest capture.
    fn is_latest(&self, frame: &FrameId) -> bool;
}

/// Why no stop path may authorize input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopPathReason {
    /// No stop path is live.
    NoGlobalListener,
    /// A usable stop path is live but its heartbeat is older than
    /// [`crate::HEARTBEAT_FRESH_MS`].
    HeartbeatStale,
    /// Only the host relay is live and `computer.allowHostRelayOnlyStop` is off.
    HostRelayNotAllowed,
    /// The macOS SkyLight receipt canary failed (reported by the backend).
    SkylightCanaryFailed,
}

impl StopPathReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NoGlobalListener => "no-global-listener",
            Self::HeartbeatStale => "heartbeat-stale",
            Self::HostRelayNotAllowed => "host-relay-not-allowed",
            Self::SkylightCanaryFailed => "skylight-canary-failed",
        }
    }
}

impl SupervisorStatus {
    /// Why no stop path authorizes input under `policy`, ignoring suspension;
    /// `None` when one does.
    #[must_use]
    pub const fn stop_path_unavailable(self, policy: &StopPolicy) -> Option<StopPathReason> {
        match (self.stop_path, self.heartbeat_fresh) {
            (ActiveStopPath::None, _) => Some(StopPathReason::NoGlobalListener),
            (ActiveStopPath::HostRelay, _) if !policy.allow_host_relay_only => {
                Some(StopPathReason::HostRelayNotAllowed)
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
    PermissionDenied,
    #[error("the frame is not the target's latest capture; capture it again before coordinate input")]
    InvalidCoordinateFrame,
}

impl GateError {
    #[must_use]
    pub const fn code(self) -> ErrorCode {
        match self {
            Self::Suspended => ErrorCode::Suspended,
            Self::StopPathUnavailable { .. } => ErrorCode::StopPathUnavailable,
            Self::ScreenLocked => ErrorCode::ScreenLocked,
            Self::PermissionDenied => ErrorCode::PermissionDenied,
            Self::InvalidCoordinateFrame => ErrorCode::InvalidCoordinateFrame,
        }
    }
}

impl From<GateError> for DesktopError {
    fn from(error: GateError) -> Self {
        Self::new(error.code(), error.to_string())
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
        return Err(GateError::StopPathUnavailable { reason });
    }
    if frames.screen_locked().is_locked() {
        return Err(GateError::ScreenLocked);
    }
    if !perms.input_granted() {
        return Err(GateError::PermissionDenied);
    }
    if action.is_coordinate() && expected_frame.is_some_and(|expected| !frames.is_latest(&expected)) {
        return Err(GateError::InvalidCoordinateFrame);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
