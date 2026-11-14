//! What the gate decides on: the facts of one call, already read, so the gate itself is pure.

use omo_computer_core::params::Point;
use omo_computer_core::results::PermissionState;
use omo_computer_core::session_state::{Tristate, UnknownLiteral};

use super::verdicts::{
    ConsentRefusal, ConsequentialRefusal, FrameRefusal, LeaseRefusal, RouteRefusal,
};
use crate::latch::SuspendReason;
use crate::stop_path::StopPathView;

/// The tier of the call: a read runs gates 1, 2, 5 and 6 only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Read,
    Exec,
}

/// How the verb resolves its effective target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerbKind {
    /// The window and element under each point.
    Pointer,
    /// The focused window.
    Keyboard,
    /// `apps.quit`: a protected or self-set owner refuses `ProtectedProcess`.
    AppsQuit,
}

/// The identity a target resolved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub pid: u32,
    /// Bundle id, AUMID or image name, `WM_CLASS` or `app_id`.
    pub app_key: String,
    /// The OS surface inside the owner (`pane`, `modal`, `lock-screen`), when the OS names one.
    pub surface: Option<String>,
}

/// What one point (or the keyboard focus) resolved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    Window(Identity),
    /// No window: the desktop itself.
    Desktop,
    /// The identity cannot be read: fails closed.
    Unreadable,
}

/// One resolved point of the call.
#[derive(Debug, Clone, PartialEq)]
pub struct PointTarget {
    pub point: Option<Point>,
    pub resolution: Resolution,
    /// Another session holds this window's reservation.
    pub reserved_by_other: bool,
}

impl PointTarget {
    #[must_use]
    pub const fn new(point: Option<Point>, resolution: Resolution) -> Self {
        Self {
            point,
            resolution,
            reserved_by_other: false,
        }
    }
}

/// The facts of one call.
#[derive(Debug, Clone, PartialEq)]
pub struct GateFacts {
    pub tier: Tier,
    pub verb: VerbKind,
    pub latch: Option<SuspendReason>,
    pub stop_path: StopPathView,
    pub screen_locked: Tristate,
    pub permission: PermissionState,
    pub consent: Option<ConsentRefusal>,
    pub route: Option<RouteRefusal>,
    pub lease: Option<LeaseRefusal>,
    /// The key chord the call sends, if it sends one.
    pub chord: Option<String>,
    pub force: bool,
    pub consequential: Option<ConsequentialRefusal>,
    pub frame: Option<FrameRefusal>,
    /// Physical input in the target within the takeover window.
    pub user_active_in_target: bool,
}

impl GateFacts {
    /// A call on which no stage after gate 2 has anything to refuse.
    #[must_use]
    pub const fn clear(tier: Tier, verb: VerbKind, stop_path: StopPathView) -> Self {
        Self {
            tier,
            verb,
            latch: None,
            stop_path,
            screen_locked: Tristate::Unknown(UnknownLiteral::Unknown),
            permission: PermissionState::Granted,
            consent: None,
            route: None,
            lease: None,
            chord: None,
            force: false,
            consequential: None,
            frame: None,
            user_active_in_target: false,
        }
    }
}
