//! The nine reasons a coordinate call is refused against its frame, each before any OS call.

use crate::backend::Refusal;
use crate::error::{EngineCode, Reason};

/// Why the frame a coordinate call names (or the target's latest) cannot take it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FrameRefusal {
    /// The target has no frame.
    FrameRequired,
    /// The named frame belongs to another target.
    WrongTarget,
    /// The named frame was never issued for this target.
    NoCapture,
    /// An epoch change, a newer capture or a frame verb replaced the frame.
    Superseded,
    /// A `consume:true` call already delivered through the frame.
    Consumed,
    /// The window's `{windowNumber|hwnd|xid, pid, processStart}` differs from the frame's.
    IdentityChanged,
    /// The window's size differs from its size at capture.
    Resized,
    /// The frame carries no logical geometry.
    PixelsOnly,
    /// The point is outside the frame or between its regions.
    OutsideFrame,
}

impl FrameRefusal {
    /// Every reason, in the order the checks run.
    pub const ALL: [Self; 9] = [
        Self::FrameRequired,
        Self::WrongTarget,
        Self::NoCapture,
        Self::Superseded,
        Self::Consumed,
        Self::IdentityChanged,
        Self::Resized,
        Self::PixelsOnly,
        Self::OutsideFrame,
    ];

    #[must_use]
    pub const fn reason(self) -> Reason {
        match self {
            Self::FrameRequired => Reason::FrameRequired,
            Self::WrongTarget => Reason::WrongTarget,
            Self::NoCapture => Reason::NoCapture,
            Self::Superseded => Reason::Superseded,
            Self::Consumed => Reason::Consumed,
            Self::IdentityChanged => Reason::IdentityChanged,
            Self::Resized => Reason::Resized,
            Self::PixelsOnly => Reason::PixelsOnly,
            Self::OutsideFrame => Reason::OutsideFrame,
        }
    }

    /// The wire refusal: `InvalidCoordinateFrame{reason}`, except a changed window identity,
    /// which is `WindowNotFound{identity_changed}`.
    #[must_use]
    pub const fn refusal(self) -> Refusal {
        let code = match self {
            Self::IdentityChanged => EngineCode::WindowNotFound,
            _ => EngineCode::InvalidCoordinateFrame,
        };
        Refusal::new(code, self.reason().wire())
    }
}
