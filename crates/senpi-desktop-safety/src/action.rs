//! The mutating-request vocabulary: every engine method that acts on the
//! desktop and therefore passes [`crate::gate`] first. Read-only requests
//! (capture, windows, AX queries, `clipboard.read`, ...) have no variant.

use senpi_desktop_core::methods::Method;

/// A side-effecting engine request, one variant per mutating method.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MutatingAction {
    Click,
    MoveMouse,
    Drag,
    Scroll,
    TypeText,
    KeyChord,
    RaiseWindow,
    AxPerform,
    AxSetValue,
    AxFocus,
    AxClick,
    ClipboardWrite,
}

impl MutatingAction {
    pub const ALL: [Self; 12] = [
        Self::Click,
        Self::MoveMouse,
        Self::Drag,
        Self::Scroll,
        Self::TypeText,
        Self::KeyChord,
        Self::RaiseWindow,
        Self::AxPerform,
        Self::AxSetValue,
        Self::AxFocus,
        Self::AxClick,
        Self::ClipboardWrite,
    ];

    /// The engine method this action is requested through.
    #[must_use]
    pub const fn method(self) -> Method {
        match self {
            Self::Click => Method::Click,
            Self::MoveMouse => Method::MoveMouse,
            Self::Drag => Method::Drag,
            Self::Scroll => Method::Scroll,
            Self::TypeText => Method::TypeText,
            Self::KeyChord => Method::KeyChord,
            Self::RaiseWindow => Method::RaiseWindow,
            Self::AxPerform => Method::AxPerform,
            Self::AxSetValue => Method::AxSetValue,
            Self::AxFocus => Method::AxFocus,
            Self::AxClick => Method::AxClick,
            Self::ClipboardWrite => Method::ClipboardWrite,
        }
    }

    /// Whether the action targets pixels of a captured frame, and so must
    /// reject a frame that is no longer the target's latest capture.
    #[must_use]
    pub const fn is_coordinate(self) -> bool {
        match self {
            Self::Click | Self::MoveMouse | Self::Drag | Self::Scroll => true,
            Self::TypeText
            | Self::KeyChord
            | Self::RaiseWindow
            | Self::AxPerform
            | Self::AxSetValue
            | Self::AxFocus
            | Self::AxClick
            | Self::ClipboardWrite => false,
        }
    }
}

#[cfg(test)]
mod tests;
