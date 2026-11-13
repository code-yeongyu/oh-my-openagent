//! The verb half of the per-(verb, report) validation key.
//!
//! A VALUE verb names the state it requests, so its read-back equal to `intended` is the
//! receipt. A pointer or key verb (an ACTION verb here) names no value, so only an OS-level
//! consumption receipt confirms it, and that receipt exists on Windows only.

use crate::methods::Method;

use super::evidence::EvidenceKind;

/// Value verb or pointer/key verb.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VerbClass {
    /// `setValue`, `type` / `paste`, `setFrame` / `minimize` / `restore`, `selectText`,
    /// `apps.quit`: the engine computes `intended` and reads the target back.
    Value,
    /// Every other exec verb: pointer, key, element action, menu, window raise.
    Action,
}

impl VerbClass {
    /// The class of every method whose reply is an `ActionReport`; `None` for the others.
    #[must_use]
    pub const fn of(method: Method) -> Option<Self> {
        match method {
            Method::Type
            | Method::Paste
            | Method::TypeText
            | Method::AxSetValue
            | Method::AxSelectText
            | Method::AppsQuit
            | Method::WindowSetFrame
            | Method::WindowMinimize
            | Method::WindowRestore => Some(Self::Value),
            // No requested value is named for these, so no read-back can be their receipt.
            Method::Click
            | Method::Move
            | Method::MouseDown
            | Method::MouseUp
            | Method::KeyDown
            | Method::KeyUp
            | Method::Drag
            | Method::Press
            | Method::Scroll
            | Method::KeyChord
            | Method::HoldKeys
            | Method::HoldMouse
            | Method::RaiseWindow
            | Method::AxPerform
            | Method::AxFocus
            | Method::MenuSelect
            | Method::AppsOpen
            | Method::WindowRaise
            | Method::WindowActivate
            | Method::ClipboardWrite
            | Method::OpenSystemSurface => Some(Self::Action),
            _ => None,
        }
    }

    /// The receipt kind that raises this verb's effect to `confirmed`.
    #[must_use]
    pub const fn confirming_kind(self) -> EvidenceKind {
        match self {
            Self::Value => EvidenceKind::ValueReadback,
            Self::Action => EvidenceKind::BarrierConsumed,
        }
    }
}

/// The platform whose backend produced the report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    Macos,
    X11,
    Wayland,
    Windows,
}

impl Platform {
    pub const ALL: [Self; 4] = [Self::Macos, Self::X11, Self::Wayland, Self::Windows];

    /// Whether this platform has the OS-level receipt `kind`: the barrier on Windows, the
    /// raw XI2 confirmation on X11. Value read-backs exist everywhere.
    #[must_use]
    pub const fn produces(self, kind: EvidenceKind) -> bool {
        match kind {
            EvidenceKind::BarrierConsumed => matches!(self, Self::Windows),
            EvidenceKind::Xi2RawConfirm => matches!(self, Self::X11),
            _ => true,
        }
    }
}

/// The key wire validation runs under: the verb, and the platform when it is known.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ReportContext {
    pub verb: VerbClass,
    pub platform: Option<Platform>,
}

impl ReportContext {
    #[must_use]
    pub const fn new(verb: VerbClass, platform: Option<Platform>) -> Self {
        Self { verb, platform }
    }
}
